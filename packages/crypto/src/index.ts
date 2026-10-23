// End-to-end encryption for vauly. Everything runs on WebCrypto, so the browser, the
// server and the CLI share one implementation. The server only ever stores what this
// module outputs: ciphertext, wrapped keys and public keys.
//
//   master password ─PBKDF2─▶ master key ─HKDF─┬─▶ auth key  (sent to the server as the login password)
//                                              └─▶ wrap key  (encrypts the account private key)
//   account keypair (ECDH P-256): receives vault keys from other members
//   vault key (AES-256-GCM): wraps the item keys of one vault
//   item key  (AES-256-GCM): encrypts one item; also wrapped to an agent's public key to grant it

import { random } from "./random";

export const KDF_ITERATIONS = 600_000;
const AES = { name: "AES-GCM", length: 256 } as const;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Bytes = Uint8Array<ArrayBuffer>;

export function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

export function fromBase64(text: string): Bytes {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function randomBytes(length: number): Bytes {
	return random.bytes(length);
}

const toHex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

// --- Master password -------------------------------------------------------------

export type MasterKeys = {
	/** Sent to the server instead of the password; the server hashes it again. */
	authKey: string;
	/** Never leaves the device. Encrypts the account private key. */
	wrapKey: CryptoKey;
};

export async function deriveMasterKeys(
	password: string,
	salt: string,
	iterations = KDF_ITERATIONS,
): Promise<MasterKeys> {
	const passwordKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password.normalize("NFKC")),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const masterBits = await crypto.subtle.deriveBits(
		{ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations },
		passwordKey,
		256,
	);
	const masterKey = await crypto.subtle.importKey(
		"raw",
		masterBits,
		"HKDF",
		false,
		["deriveBits", "deriveKey"],
	);
	const hkdf = (info: string) => ({
		name: "HKDF",
		hash: "SHA-256",
		salt: new Uint8Array(32),
		info: encoder.encode(info),
	});
	const authBits = await crypto.subtle.deriveBits(
		hkdf("vauly/auth"),
		masterKey,
		256,
	);
	const wrapKey = await crypto.subtle.deriveKey(
		hkdf("vauly/wrap"),
		masterKey,
		AES,
		false,
		["encrypt", "decrypt"],
	);
	return { authKey: toHex(new Uint8Array(authBits)), wrapKey };
}

export const newSalt = () => toBase64(randomBytes(16));

// --- Symmetric encryption --------------------------------------------------------

/** `base64(iv) . base64(ciphertext)`: the only ciphertext format vauly stores. */
export type Sealed = string;

export async function seal(
	key: CryptoKey,
	plaintext: Uint8Array,
): Promise<Sealed> {
	const iv = randomBytes(12);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		key,
		plaintext as Bytes,
	);
	return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function open(key: CryptoKey, sealed: Sealed): Promise<Bytes> {
	const [iv, ciphertext] = sealed.split(".");
	if (!iv || !ciphertext) throw new Error("Malformed ciphertext");
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: fromBase64(iv) },
		key,
		fromBase64(ciphertext),
	);
	return new Uint8Array(plaintext);
}

export const sealJson = (key: CryptoKey, value: unknown) =>
	seal(key, encoder.encode(JSON.stringify(value)));

export async function openJson<T>(key: CryptoKey, sealed: Sealed): Promise<T> {
	return JSON.parse(decoder.decode(await open(key, sealed))) as T;
}

// --- Data keys (vault keys and item keys) ----------------------------------------

export function newDataKey(): Promise<CryptoKey> {
	return crypto.subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
}

/** Encrypts a data key with another symmetric key (vault key → item key). */
export async function wrapKey(
	wrapping: CryptoKey,
	key: CryptoKey,
): Promise<Sealed> {
	return seal(
		wrapping,
		new Uint8Array(await crypto.subtle.exportKey("raw", key)),
	);
}

export async function unwrapKey(
	wrapping: CryptoKey,
	sealed: Sealed,
): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		await open(wrapping, sealed),
		AES,
		true,
		["encrypt", "decrypt"],
	);
}

// --- Share links ----------------------------------------------------------------

/** A data key as URL-safe base64, to travel in a share link's #fragment. */
export async function keyToText(key: CryptoKey): Promise<string> {
	const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
	return toBase64(raw)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export async function keyFromText(text: string): Promise<CryptoKey> {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	const raw = fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	if (raw.length !== 32) throw new Error("Not a link key");
	return crypto.subtle.importKey("raw", raw, AES, false, ["decrypt"]);
}

// --- Keypairs (people and agents) ------------------------------------------------

export type Keypair = { publicKey: string; privateKey: CryptoKey };

export async function newKeypair(): Promise<
	Keypair & { privateKeyRaw: Bytes }
> {
	const pair = await random.ecdhKeyPair();
	const publicKey = toBase64(
		new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
	);
	const privateKeyRaw = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", pair.privateKey),
	);
	return { publicKey, privateKey: pair.privateKey, privateKeyRaw };
}

export const importPrivateKey = (pkcs8: Uint8Array) =>
	crypto.subtle.importKey("pkcs8", pkcs8 as Bytes, ECDH, true, ["deriveBits"]);

const importPublicKey = (spki: string) =>
	crypto.subtle.importKey("spki", fromBase64(spki), ECDH, true, []);

async function sharedKey(
	privateKey: CryptoKey,
	publicKey: CryptoKey,
	context: Uint8Array,
) {
	const secret = await crypto.subtle.deriveBits(
		{ name: "ECDH", public: publicKey },
		privateKey,
		256,
	);
	const hkdfKey = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
		"deriveKey",
	]);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(32),
			info: context as Bytes,
		},
		hkdfKey,
		AES,
		false,
		["encrypt", "decrypt"],
	);
}

/** Wraps a data key so only the holder of `recipientPublicKey` can open it (ECIES). */
export async function wrapKeyFor(
	recipientPublicKey: string,
	key: CryptoKey,
): Promise<string> {
	const ephemeral = await random.ecdhKeyPair();
	const ephemeralPublic = new Uint8Array(
		await crypto.subtle.exportKey("spki", ephemeral.publicKey),
	);
	const aes = await sharedKey(
		ephemeral.privateKey,
		await importPublicKey(recipientPublicKey),
		encoder.encode(`vauly/share:${recipientPublicKey}`),
	);
	return `${toBase64(ephemeralPublic)}:${await wrapKey(aes, key)}`;
}

export async function unwrapKeyFrom(
	privateKey: CryptoKey,
	ownPublicKey: string,
	wrapped: string,
): Promise<CryptoKey> {
	const [ephemeralPublic, sealed] = wrapped.split(":");
	if (!ephemeralPublic || !sealed) throw new Error("Malformed wrapped key");
	const aes = await sharedKey(
		privateKey,
		await importPublicKey(ephemeralPublic),
		encoder.encode(`vauly/share:${ownPublicKey}`),
	);
	return unwrapKey(aes, sealed);
}

// --- Account bundle --------------------------------------------------------------

/** What the server stores per person: it can hand it back, but cannot open it. */
export type AccountKeys = {
	kdfSalt: string;
	kdfIterations: number;
	publicKey: string;
	encryptedPrivateKey: Sealed;
};

export async function createAccount(
	password: string,
	iterations = KDF_ITERATIONS,
) {
	const kdfSalt = newSalt();
	const { authKey, wrapKey: wrap } = await deriveMasterKeys(
		password,
		kdfSalt,
		iterations,
	);
	const pair = await newKeypair();
	const keys: AccountKeys = {
		kdfSalt,
		kdfIterations: iterations,
		publicKey: pair.publicKey,
		encryptedPrivateKey: await seal(wrap, pair.privateKeyRaw),
	};
	return { authKey, keys, privateKey: pair.privateKey };
}

/** Opens the private key with an already derived wrap key. Fails on a wrong password. */
export async function openPrivateKey(
	wrap: CryptoKey,
	encryptedPrivateKey: Sealed,
): Promise<CryptoKey> {
	return importPrivateKey(await open(wrap, encryptedPrivateKey));
}

export async function unlockAccount(password: string, keys: AccountKeys) {
	const { authKey, wrapKey: wrap } = await deriveMasterKeys(
		password,
		keys.kdfSalt,
		keys.kdfIterations,
	);
	return {
		authKey,
		privateKey: await openPrivateKey(wrap, keys.encryptedPrivateKey),
	};
}

/**
 * Moves an account to a new master password: the same key pair, sealed under keys derived
 * from the new password with a fresh salt. Throws if the current password is wrong.
 */
export async function changeMasterPassword(
	current: string,
	next: string,
	keys: AccountKeys,
	iterations = KDF_ITERATIONS,
) {
	const old = await deriveMasterKeys(current, keys.kdfSalt, keys.kdfIterations);
	const privateKeyRaw = await open(old.wrapKey, keys.encryptedPrivateKey);
	const kdfSalt = newSalt();
	const fresh = await deriveMasterKeys(next, kdfSalt, iterations);
	return {
		currentAuthKey: old.authKey,
		authKey: fresh.authKey,
		keys: {
			kdfSalt,
			kdfIterations: iterations,
			publicKey: keys.publicKey,
			encryptedPrivateKey: await seal(fresh.wrapKey, privateKeyRaw),
		} satisfies AccountKeys,
	};
}

// --- Unlocking with a passkey ----------------------------------------------------

/**
 * The key that seals this device's copy of the private key, from a passkey's PRF output.
 * Only the authenticator can produce that output, and only after Face ID, Touch ID or a
 * PIN, so the copy is useless to anyone holding just the device's storage.
 */
export async function deviceKey(prfOutput: Uint8Array): Promise<CryptoKey> {
	const secret = await crypto.subtle.importKey(
		"raw",
		prfOutput as Bytes,
		"HKDF",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(32),
			info: encoder.encode("vauly/device"),
		},
		secret,
		AES,
		false,
		["encrypt", "decrypt"],
	);
}

/** Seals the account's private key (PKCS#8) with another key; `openPrivateKey` opens it. */
export async function sealPrivateKey(
	key: CryptoKey,
	privateKey: CryptoKey,
): Promise<Sealed> {
	return seal(
		key,
		new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey)),
	);
}

// --- Agent tokens ----------------------------------------------------------------

/** `vauly_agent_<id>.<secret>.<private key>`: everything an agent needs, shown once. */
export function encodeAgentToken(
	agentId: string,
	secret: string,
	privateKeyRaw: Uint8Array,
) {
	return `vauly_agent_${agentId}.${secret}.${toBase64(privateKeyRaw).replaceAll("/", "_").replaceAll("+", "-")}`;
}

export function decodeAgentToken(token: string) {
	const match = /^vauly_agent_([^.]+)\.([^.]+)\.(.+)$/.exec(token.trim());
	if (!match?.[1] || !match[2] || !match[3])
		throw new Error("Not a vauly agent token");
	return {
		agentId: match[1],
		secret: match[2],
		privateKeyRaw: fromBase64(
			match[3].replaceAll("_", "/").replaceAll("-", "+"),
		),
	};
}

export const newSecret = () => toHex(randomBytes(24));

export async function sha256Hex(text: string) {
	return toHex(
		new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text))),
	);
}

export * from "./totp";
