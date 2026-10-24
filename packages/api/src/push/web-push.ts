// Web Push from the Worker, on WebCrypto alone: the message encrypted to the browser's
// keys as one aes128gcm record (RFC 8291), and the request signed with the server's VAPID
// key (RFC 8292). The push service sees where it goes and how big it is, never what it says.

/** What a browser hands over when it subscribes: its P-256 public key and auth secret. */
export type PushKeys = { p256dh: string; auth: string };

/** The server's own key pair: the public key as base64url, the private one as a JWK. */
export type VapidKeys = { publicKey: string; privateKey: JsonWebKey };

const encoder = new TextEncoder();
const RECORD_SIZE = 4096;
// The header (salt, record size, key) and the record's padding delimiter and tag.
const OVERHEAD = 16 + 4 + 1 + 65 + 1 + 16;
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

type Bytes = Uint8Array<ArrayBuffer>;

export function toBase64Url(bytes: Uint8Array | ArrayBuffer) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return btoa(String.fromCharCode(...view))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function fromBase64Url(text: string) {
	const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
	return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt, info },
		key,
		length * 8,
	);
	return new Uint8Array(bits);
}

/** Whether `keys` are a P-256 public key and a 16-byte secret, as a browser makes them. */
export async function validKeys(keys: PushKeys) {
	try {
		if (fromBase64Url(keys.auth).length !== 16) return false;
		const point = fromBase64Url(keys.p256dh);
		if (point.length !== 65 || point[0] !== 4) return false;
		await crypto.subtle.importKey("raw", point, P256, false, []);
		return true;
	} catch {
		return false;
	}
}

/**
 * The message as the body of a push: one aes128gcm record for the browser that holds
 * `keys`, padded with zeros to `padTo` bytes, so pushes of different lengths look the
 * same size. Each message gets a new key pair and salt; the tests pass fixed ones.
 */
export async function encryptPush(
	message: Uint8Array,
	keys: PushKeys,
	{
		padTo = 0,
		sender: fixedSender,
		salt: fixedSalt,
	}: {
		padTo?: number;
		sender?: { privateKey: CryptoKey; publicKey: Bytes };
		salt?: Bytes;
	} = {},
) {
	if (message.length > RECORD_SIZE - OVERHEAD)
		throw new Error("A push message holds at most 3993 bytes");
	const padding = Math.max(
		0,
		Math.min(padTo, RECORD_SIZE - OVERHEAD) - message.length,
	);
	const receiver = fromBase64Url(keys.p256dh);
	const authSecret = fromBase64Url(keys.auth);
	const sender = fixedSender ?? (await newSenderKeys());
	const salt = fixedSalt ?? crypto.getRandomValues(new Uint8Array(16));

	const receiverKey = await crypto.subtle.importKey(
		"raw",
		receiver,
		P256,
		false,
		[],
	);
	const shared = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: receiverKey },
			sender.privateKey,
			256,
		),
	);
	const keyInfo = concat(
		encoder.encode("WebPush: info\0"),
		receiver,
		sender.publicKey,
	);
	const ikm = await hkdf(authSecret, shared, keyInfo, 32);
	const contentKey = await hkdf(
		salt,
		ikm,
		encoder.encode("Content-Encoding: aes128gcm\0"),
		16,
	);
	const nonce = await hkdf(
		salt,
		ikm,
		encoder.encode("Content-Encoding: nonce\0"),
		12,
	);

	const aes = await crypto.subtle.importKey(
		"raw",
		contentKey,
		"AES-GCM",
		false,
		["encrypt"],
	);
	// The only record is the last one, so its padding starts with the delimiter 0x02.
	const record = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: nonce },
			aes,
			concat(message, new Uint8Array([2]), new Uint8Array(padding)),
		),
	);
	const header = new Uint8Array(16 + 4 + 1);
	header.set(salt);
	new DataView(header.buffer).setUint32(16, RECORD_SIZE);
	header[20] = sender.publicKey.length;
	return concat(header, sender.publicKey, record);
}

async function newSenderKeys() {
	const pair = await crypto.subtle.generateKey(P256, true, ["deriveBits"]);
	const publicKey = new Uint8Array(
		await crypto.subtle.exportKey("raw", pair.publicKey),
	);
	return { privateKey: pair.privateKey, publicKey };
}

/** A new VAPID key pair for the server. */
export async function newVapidKeys(): Promise<VapidKeys> {
	const pair = await crypto.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	);
	const [publicKey, privateKey] = await Promise.all([
		crypto.subtle.exportKey("raw", pair.publicKey),
		crypto.subtle.exportKey("jwk", pair.privateKey),
	]);
	return {
		publicKey: toBase64Url(publicKey),
		privateKey: privateKey as JsonWebKey,
	};
}

/**
 * The Authorization header for a push to `endpoint`: a JWT for its push service, signed
 * with the server's VAPID key and good for 12 hours, and the key to check it with.
 * `subject` is how the push service can reach whoever runs the server.
 */
export async function vapidAuthorization(
	endpoint: string,
	keys: VapidKeys,
	subject: string,
	now = Date.now(),
) {
	const encode = (value: object) =>
		toBase64Url(encoder.encode(JSON.stringify(value)));
	const unsigned = `${encode({ typ: "JWT", alg: "ES256" })}.${encode({
		aud: new URL(endpoint).origin,
		exp: Math.floor(now / 1000) + 12 * 60 * 60,
		sub: subject,
	})}`;
	const key = await crypto.subtle.importKey(
		"jwk",
		keys.privateKey,
		{ name: "ECDSA", namedCurve: "P-256" },
		false,
		["sign"],
	);
	// WebCrypto's ECDSA signature is r and s side by side, which is what ES256 wants.
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		encoder.encode(unsigned),
	);
	return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}
