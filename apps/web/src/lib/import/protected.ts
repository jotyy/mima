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
		material = new Uint8Array(
			await argon2(
				secret,
				hashed,
				kdf.iterations,
				kdf.memory * 1024,
				kdf.parallelism,
			),
		);
	}
	const [encryption, mac] = await Promise.all([
		expand(material, "enc"),
		expand(material, "mac"),
	]);
	material.fill(0);
	return {
		encryption: await crypto.subtle.importKey(
			"raw",
			encryption,
			"AES-CBC",
			false,
			["decrypt", "encrypt"],
		),
		mac: await crypto.subtle.importKey(
			"raw",
			mac,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign", "verify"],
		),
	};
}

/**
 * An EncString of type 2, "2.<iv>|<ciphertext>|<mac>": AES-256-CBC, and HMAC-SHA256 of
 * iv ‖ ciphertext, which is checked first. Null when the MAC doesn't match.
 */
async function decryptEncString(value: unknown, key: ExportKey) {
	const parts = /^2\.([\w+/=]+)\|([\w+/=]+)\|([\w+/=]+)$/.exec(String(value));
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

/** The plain Bitwarden JSON inside a password-protected export. */
export async function openBitwardenExport(
	root: Record<string, unknown>,
	password: string,
	argon2: Argon2Lanes,
) {
	const kdf = bitwardenKdf(root);
	if (!kdf)
		throw new ImportError(
			"That Bitwarden export asks for key settings Bitwarden itself doesn't use, so vauly won't open it.",
		);
	if (typeof root.salt !== "string" || !root.salt)
		throw new ImportError("That Bitwarden file isn't one vauly can read.");
	if (!password) throw new WrongPasswordError();
	const key = await bitwardenKey(password, root.salt, kdf, argon2);
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

/** What a Proton Pass .pgp holds: its data.json, or, from older exports, the whole ZIP. */
export async function openProtonPass(armored: string, password: string) {
	const openpgp = await import("openpgp");
	let message: Awaited<ReturnType<typeof openpgp.readMessage>>;
	try {
		message = await openpgp.readMessage({ armoredMessage: armored });
	} catch {
		throw new ImportError("That PGP file couldn't be read.");
	}
	if (!password) throw new WrongPasswordError();
	try {
		const { data } = await openpgp.decrypt({
			message,
			passwords: [password],
			format: "binary",
		});
		return data as Uint8Array;
	} catch {
		// A wrong passphrase and a damaged file look the same to OpenPGP; Proton's own
		// import calls both a wrong passphrase.
		throw new WrongPasswordError();
	}
}
