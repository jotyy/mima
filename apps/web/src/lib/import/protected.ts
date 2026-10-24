import { toBase64 as base64 } from "@vauly/crypto";

import { ImportError } from "./parsed";

// Exports that another app protected with a password: Bitwarden's password-protected
// .json and Proton Pass's PGP-encrypted export. They're opened here, in the browser; the
// password and what it opens never leave this device, and neither is kept.

export class WrongPasswordError extends Error {
	constructor() {
		super("That password didn't open the file. Check it and try again.");
	}
}

/** Argon2id with lanes (@vauly/crypto/argon2-lanes), in the key worker in the app. */
export type Argon2Lanes = (
	password: Uint8Array,
	salt: Uint8Array,
	passes: number,
	memory: number,
	lanes: number,
) => Promise<Uint8Array>;

type Bytes = Uint8Array<ArrayBuffer>;
const encoder = new TextEncoder();
const bytes = (base64: string): Bytes =>
	Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

// --- Bitwarden ------------------------------------------------------------------------
// As bitwarden/clients builds and reads them: BaseVaultExportService.buildPasswordExport,
// BitwardenPasswordProtectedImporter and DefaultKeyGenerationService.deriveVaultExportKey,
// with the KDF itself in bitwarden/sdk-internal (crates/bitwarden-crypto/src/keys/kdf.rs).

export type BitwardenKdf =
	| { type: "pbkdf2"; iterations: number }
	| {
			type: "argon2id";
			iterations: number;
			memory: number;
			parallelism: number;
	  };

/**
 * The KDF settings a file may ask for: the ones Bitwarden's own import takes, from
 * libs/importer/src/importers/bitwarden/password-protected-kdf-config.ts in
 * bitwarden/clients, with the maximums of libs/legacy-crypto/src/models/kdf-config.ts.
 * The file sets them, so they're checked before anything is derived: Argon2 takes its
 * memory (here in MiB) up front.
 */
export const BITWARDEN_KDF_BOUNDS = {
	pbkdf2: { iterations: [5_000, 2_000_000] },
	argon2id: { iterations: [2, 10], memory: [16, 1024], parallelism: [1, 16] },
} as const;

const within = (value: unknown, [min, max]: readonly [number, number]) =>
	Number.isInteger(value) &&
	(value as number) >= min &&
	(value as number) <= max;

/**
 * vauly's own settings for a password-protected backup in this format: Argon2id with
 * 64 MiB, three passes and one lane, as for a master password (docs/security.md).
 */
export const BACKUP_KDF: BitwardenKdf = {
	type: "argon2id",
	iterations: 3,
	memory: 64,
	parallelism: 1,
};

/** A password-protected export, as opposed to an account-restricted one or none. */
export const isBitwardenProtected = (root: Record<string, unknown>) =>
	root.encrypted === true && root.passwordProtected === true;

/** The file's KDF, or null when it asks for something Bitwarden itself wouldn't make. */
export function bitwardenKdf(
	root: Record<string, unknown>,
): BitwardenKdf | null {
	const { pbkdf2, argon2id } = BITWARDEN_KDF_BOUNDS;
	if (root.kdfType === 0 && within(root.kdfIterations, pbkdf2.iterations))
		return { type: "pbkdf2", iterations: root.kdfIterations as number };
	if (
		root.kdfType === 1 &&
		within(root.kdfIterations, argon2id.iterations) &&
		within(root.kdfMemory, argon2id.memory) &&
		within(root.kdfParallelism, argon2id.parallelism)
	)
		return {
			type: "argon2id",
			iterations: root.kdfIterations as number,
			memory: root.kdfMemory as number,
			parallelism: root.kdfParallelism as number,
		};
	return null;
}

type ExportKey = { encryption: CryptoKey; mac: CryptoKey };

/** HKDF-Expand alone, one 32-byte block: Bitwarden's stretchKey, info "enc" or "mac". */
async function expand(material: Bytes, info: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		material,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			new Uint8Array([...encoder.encode(info), 1]),
		),
	);
}

/**
 * The file's key from its password. The salt is the base64 text in the file, taken as
 * UTF-8, not the bytes it encodes; Argon2id hashes it with SHA-256 first.
 */
async function bitwardenKey(
	password: string,
	salt: string,
	kdf: BitwardenKdf,
	argon2: Argon2Lanes,
	use: "open" | "seal" = "open",
): Promise<ExportKey> {
	const secret = encoder.encode(password);
	let material: Bytes;
	if (kdf.type === "pbkdf2") {
		const base = await crypto.subtle.importKey("raw", secret, "PBKDF2", false, [
			"deriveBits",
		]);
		material = new Uint8Array(
			await crypto.subtle.deriveBits(
				{
					name: "PBKDF2",
					hash: "SHA-256",
					salt: encoder.encode(salt),
					iterations: kdf.iterations,
				},
				base,
				256,
			),
		);
	} else {
		const hashed = new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode(salt)),
		);
		const output = await argon2(
			secret,
			hashed,
			kdf.iterations,
			kdf.memory * 1024,
			kdf.parallelism,
		);
		material = new Uint8Array(output);
		output.fill(0);
	}
	secret.fill(0);
	const [encryption, mac] = await Promise.all([
		expand(material, "enc"),
		expand(material, "mac"),
	]);
	material.fill(0);
	const key = {
		encryption: await crypto.subtle.importKey(
			"raw",
			encryption,
			"AES-CBC",
			false,
			[use === "open" ? "decrypt" : "encrypt"],
		),
		mac: await crypto.subtle.importKey(
			"raw",
			mac,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			[use === "open" ? "verify" : "sign"],
		),
	};
	encryption.fill(0);
	mac.fill(0);
	return key;
}

/** An EncString of type 2, "2.<iv>|<ciphertext>|<mac>", all base64. */
const ENC_STRING = /^2\.([\w+/=]+)\|([\w+/=]+)\|([\w+/=]+)$/;

/**
 * An EncString of type 2: AES-256-CBC, and HMAC-SHA256 of iv ‖ ciphertext, which is
 * checked first. Null when the MAC doesn't match.
 */
async function decryptEncString(value: unknown, key: ExportKey) {
	const parts = ENC_STRING.exec(String(value));
	if (!parts)
		throw new ImportError("That Bitwarden file isn't one vauly can read.");
	const [iv, data, mac] = [parts[1], parts[2], parts[3]].map((part) =>
		bytes(part ?? ""),
	) as [Bytes, Bytes, Bytes];
	if (iv.length !== 16 || mac.length !== 32 || data.length % 16 !== 0)
		throw new ImportError("That Bitwarden file isn't one vauly can read.");
	const signed = new Uint8Array(iv.length + data.length);
	signed.set(iv);
	signed.set(data, iv.length);
	if (!(await crypto.subtle.verify("HMAC", key.mac, mac, signed))) return null;
	return new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key.encryption, data),
	);
}

/**
 * The KDF of a password-protected export that vauly will open, checked before anyone is
 * asked for its password: settings Bitwarden's own import takes, a salt, and two
 * EncStrings of type 2.
 */
export function checkBitwardenExport(root: Record<string, unknown>) {
	const kdf = bitwardenKdf(root);
	if (!kdf)
		throw new ImportError(
			"That Bitwarden export asks for key settings Bitwarden itself doesn't use, so vauly won't open it.",
		);
	if (
		typeof root.salt !== "string" ||
		!root.salt ||
		root.salt.length > 64 ||
		!ENC_STRING.test(String(root.encKeyValidation_DO_NOT_EDIT)) ||
		!ENC_STRING.test(String(root.data))
	)
		throw new ImportError("That Bitwarden file isn't one vauly can read.");
	return { kdf, salt: root.salt };
}

/** AES-256-CBC with a fresh IV, and HMAC-SHA256 of iv ‖ ciphertext. */
async function seal(plain: Bytes, key: ExportKey) {
	const iv = crypto.getRandomValues(new Uint8Array(16));
	const data = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key.encryption, plain),
	);
	const signed = new Uint8Array(iv.length + data.length);
	signed.set(iv);
	signed.set(data, iv.length);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key.mac, signed));
	return { iv, data, mac };
}

/** An EncString of type 2 for `plain`. */
async function encryptEncString(plain: Bytes, key: ExportKey) {
	const { iv, data, mac } = await seal(plain, key);
	return `2.${base64(iv)}|${base64(data)}|${base64(mac)}`;
}

/** A 64-byte key, AES-256-CBC's then HMAC-SHA256's, as Bitwarden keeps an attachment's. */
async function fileKey(raw: Bytes, use: "open" | "seal"): Promise<ExportKey> {
	return {
		encryption: await crypto.subtle.importKey(
			"raw",
			raw.subarray(0, 32),
			"AES-CBC",
			false,
			[use === "open" ? "decrypt" : "encrypt"],
		),
		mac: await crypto.subtle.importKey(
			"raw",
			raw.subarray(32),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			[use === "open" ? "verify" : "sign"],
		),
	};
}

/** What a protected backup's export says of a file beside it. */
export type SealedFile = {
	/** The file's own key: 64 random bytes, in base64. */
	key: string;
	/** Its size, before it was sealed. */
	size: number;
	/** The SHA-256 of its contents, in base64. */
	sha256: string;
};

/** What the export says of a file, or null when it isn't that. */
export function sealedFileOf(value: unknown): SealedFile | null {
	const about = value as Partial<SealedFile> | null;
	return about &&
		typeof about === "object" &&
		typeof about.key === "string" &&
		typeof about.sha256 === "string" &&
		Number.isSafeInteger(about.size) &&
		(about.size as number) >= 0
		? (about as SealedFile)
		: null;
}

/** A file of `size` bytes, sealed: the byte 2, the IV, the MAC, and the padded ciphertext. */
export const sealedSize = (size: number) =>
	1 + 16 + 32 + (Math.floor(size / 16) + 1) * 16;

const sha256 = async (data: Bytes) =>
	base64(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));

/**
 * The files of a protected backup, each the way Bitwarden encrypts an attachment: with a
 * random 64-byte key of its own, as an EncArrayBuffer of type 2 (the byte 2, the IV, the
 * MAC, then the ciphertext). What `about` says of each, its key included, goes into the
 * export, which only the backup's password opens. The export's own key seals no file, so
 * no file can pass for the export.
 */
export async function sealFiles(files: Map<string, Uint8Array>) {
	const sealed = new Map<string, Uint8Array>();
	const about: Record<string, SealedFile> = {};
	for (const [path, data] of files) {
		const plain = new Uint8Array(data);
		const raw = crypto.getRandomValues(new Uint8Array(64));
		const {
			iv,
			data: ciphertext,
			mac,
		} = await seal(plain, await fileKey(raw, "seal"));
		const out = new Uint8Array(sealedSize(plain.length));
		out[0] = 2;
		out.set(iv, 1);
		out.set(mac, 17);
		out.set(ciphertext, 49);
		sealed.set(path, out);
		about[path] = {
			key: base64(raw),
			size: plain.length,
			sha256: await sha256(plain),
		};
		raw.fill(0);
	}
	return { files: sealed, about };
}

/**
 * A file from sealFiles, opened with what the export says of it, its MAC checked first.
 * Null when it doesn't match, in size, MAC or contents.
 */
export async function openFile(sealed: Uint8Array, about: SealedFile) {
	if (sealed[0] !== 2 || sealed.length !== sealedSize(about.size)) return null;
	let raw: Bytes;
	try {
		raw = bytes(about.key);
	} catch {
		return null;
	}
	if (raw.length !== 64) return null;
	const key = await fileKey(raw, "open");
	raw.fill(0);
	const iv = sealed.slice(1, 17);
	const mac = sealed.slice(17, 49);
	const data = sealed.slice(49);
	const signed = new Uint8Array(iv.length + data.length);
	signed.set(iv);
	signed.set(data, iv.length);
	if (!(await crypto.subtle.verify("HMAC", key.mac, mac, signed))) return null;
	const plain = new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key.encryption, data),
	);
	return plain.length === about.size && (await sha256(plain)) === about.sha256
		? plain
		: null;
}

/**
 * A vauly backup protected with a password: `json`, a plain Bitwarden JSON export, as a
 * password-protected export, made as BaseVaultExportService.buildPasswordExport makes it
 * so Bitwarden opens it as well as vauly. The salt is 16 random bytes in base64.
 * "vauly": 1 beside the encrypted parts says it's vauly's; Bitwarden doesn't read it.
 */
export async function sealBackup(
	json: string,
	password: string,
	argon2: Argon2Lanes,
	kdf: BitwardenKdf = BACKUP_KDF,
) {
	const salt = base64(crypto.getRandomValues(new Uint8Array(16)));
	const key = await bitwardenKey(password, salt, kdf, argon2, "seal");
	const file: Record<string, unknown> = {
		encrypted: true,
		passwordProtected: true,
		vauly: 1,
		salt,
		kdfType: kdf.type === "argon2id" ? 1 : 0,
		kdfIterations: kdf.iterations,
		encKeyValidation_DO_NOT_EDIT: await encryptEncString(
			encoder.encode(crypto.randomUUID()),
			key,
		),
		data: await encryptEncString(encoder.encode(json), key),
	};
	if (kdf.type === "argon2id") {
		file.kdfMemory = kdf.memory;
		file.kdfParallelism = kdf.parallelism;
	}
	return JSON.stringify(file, null, "  ");
}

/** The plain Bitwarden JSON inside a password-protected export. */
export async function openBitwardenExport(
	root: Record<string, unknown>,
	password: string,
	argon2: Argon2Lanes,
) {
	const { kdf, salt } = checkBitwardenExport(root);
	// Bitwarden refuses a password of only spaces too.
	if (!password.trim()) throw new WrongPasswordError();
	const key = await bitwardenKey(password, salt, kdf, argon2);
	if (!(await decryptEncString(root.encKeyValidation_DO_NOT_EDIT, key)))
		throw new WrongPasswordError();
	const data = await decryptEncString(root.data, key);
	if (!data)
		throw new ImportError(
			"That Bitwarden file was changed after it was exported, so vauly won't open it.",
		);
	return new TextDecoder().decode(data);
}

// --- Proton Pass ----------------------------------------------------------------------
// Symmetric OpenPGP, as encryptPassExport makes it in ProtonMail/WebClients
// (packages/pass/lib/crypto/utils/export.ts). OpenPGP.js is loaded only for these files.

const NOT_PROTON = "That isn't a Proton Pass export vauly can open.";

/** What an export may unpack to: far more than any vault, far less than a tab can hold. */
const MAX_PROTON_SIZE = 256 * 1024 * 1024;

/**
 * What a Proton Pass .pgp holds: its data.json, or, from older exports, the whole ZIP.
 * Proton encrypts to one passphrase, with one iterated and salted S2K. Anything else is
 * refused before the passphrase is tried: OpenPGP.js would try every passphrase packet
 * at once, each as much hashing as the file asks for, on the page's thread.
 */
export async function openProtonPass(armored: string, password: string) {
	const openpgp = await import("openpgp");
	let message: Awaited<ReturnType<typeof openpgp.readMessage>>;
	try {
		message = await openpgp.readMessage({ armoredMessage: armored });
	} catch {
		throw new ImportError("That PGP file couldn't be read.");
	}
	const { symEncryptedSessionKey, publicKeyEncryptedSessionKey } =
		openpgp.enums.packet;
	const passphrases = message.packets.filterByTag(symEncryptedSessionKey);
	const s2k = (passphrases[0] as unknown as { s2k?: { type?: string } })?.s2k;
	if (
		passphrases.length !== 1 ||
		message.packets.filterByTag(publicKeyEncryptedSessionKey).length > 0 ||
		s2k?.type !== "iterated"
	)
		throw new ImportError(NOT_PROTON);
	if (!password.trim()) throw new WrongPasswordError();
	try {
		const { data } = await openpgp.decrypt({
			message,
			passwords: [password],
			format: "binary",
			config: { maxDecompressedMessageSize: MAX_PROTON_SIZE },
		});
		return data as Uint8Array;
	} catch {
		// A wrong passphrase and a damaged file look the same to OpenPGP; Proton's own
		// import calls both a wrong passphrase.
		throw new WrongPasswordError();
	}
}
