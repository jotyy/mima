import { argon2d, argon2id } from "hash-wasm";
import * as kdbxweb from "kdbxweb";

// Opens a KeePass database (.kdbx, versions 3.1 and 4) with its password and key file,
// and hands it back as KeePass XML, held in memory only, for the XML import to read.
// It runs in the import worker (kdbx.worker.ts), which may compile WebAssembly, as the
// page may not, and can't connect anywhere. A database says how hard its key is to
// derive: one that asks for more than a database needs is refused before anything runs.

export const KDBX_LIMITS = {
	/** Argon2's memory, in KiB: 1 GiB. */
	memory: 1024 * 1024,
	passes: 100,
	lanes: 16,
	/** AES-KDF's rounds: about a minute on a slow laptop. */
	aesRounds: 200_000_000,
	/** The file itself, in bytes. */
	fileSize: 100 * 1024 * 1024,
};

export type KdbxFailure =
	| "wrong-key"
	| "too-costly"
	| "not-kdbx"
	| "unsupported"
	| "corrupt";

/** Why a database didn't open, with what the person can do about it. */
export class KdbxOpenError extends Error {
	constructor(
		readonly reason: KdbxFailure,
		message: string,
	) {
		super(message);
	}
}

const tooCostly = (what: string) =>
	new KdbxOpenError(
		"too-costly",
		`This database asks for ${what}, more than vauly's import allows. In KeePass, lower it under Database Settings › Security, save, and try again; or export to XML.`,
	);

function checkArgon2(memory: number, passes: number, lanes: number) {
	if (memory > KDBX_LIMITS.memory) {
		throw tooCostly(`${Math.round(memory / 1024)} MiB of memory to open`);
	}
	if (passes > KDBX_LIMITS.passes) throw tooCostly(`${passes} Argon2 passes`);
	if (lanes > KDBX_LIMITS.lanes) throw tooCostly(`${lanes} Argon2 lanes`);
}

const toNumber = (value: unknown) =>
	value instanceof kdbxweb.Int64
		? value.value
		: typeof value === "number"
			? value
			: Number.NaN;

/** Reads the header's key derivation settings and refuses costly ones, before deriving. */
function checkHeader(file: ArrayBuffer) {
	let header: kdbxweb.KdbxHeader;
	try {
		header = kdbxweb.KdbxHeader.read(
			new kdbxweb.BinaryStream(file),
			new kdbxweb.KdbxContext({ kdbx: {} as kdbxweb.Kdbx }),
		);
	} catch (error) {
		throw failure(error);
	}
	const params = header.kdfParameters;
	if (!params) {
		const rounds = header.keyEncryptionRounds ?? 0;
		if (rounds > KDBX_LIMITS.aesRounds) {
			throw tooCostly(`${rounds.toLocaleString("en")} AES-KDF rounds`);
		}
		return;
	}
	const kdf = kdbxweb.ByteUtils.bytesToBase64(
		params.get("$UUID") as ArrayBuffer,
	);
	if (kdf === kdbxweb.Consts.KdfId.Aes) {
		const rounds = toNumber(params.get("R"));
		if (!(rounds <= KDBX_LIMITS.aesRounds)) {
			throw tooCostly(`${rounds.toLocaleString("en")} AES-KDF rounds`);
		}
	} else {
		checkArgon2(
			toNumber(params.get("M")) / 1024,
			toNumber(params.get("I")),
			toNumber(params.get("P")),
		);
	}
}

kdbxweb.CryptoEngine.setArgon2Impl(
	async (password, salt, memory, passes, length, lanes, type, version) => {
		// Checked here too, in case the header said one thing and the KDF reads another.
		checkArgon2(memory, passes, lanes);
		if (version !== 0x13) {
			throw new KdbxOpenError(
				"unsupported",
				"This database uses an old version of Argon2. Open it in KeePass, save it again, and try again; or export to XML.",
			);
		}
		const options = {
			password: new Uint8Array(password),
			salt: new Uint8Array(salt),
			parallelism: lanes,
			iterations: passes,
			memorySize: memory,
			hashLength: length,
			outputType: "binary" as const,
		};
		const hash =
			type === kdbxweb.CryptoEngine.Argon2TypeArgon2id
				? await argon2id(options)
				: await argon2d(options);
		return new Uint8Array(hash).buffer;
	},
);

function failure(error: unknown): KdbxOpenError {
	if (error instanceof KdbxOpenError) return error;
	const code = error instanceof kdbxweb.KdbxError ? error.code : "";
	switch (code) {
		case kdbxweb.Consts.ErrorCodes.InvalidKey:
			return new KdbxOpenError(
				"wrong-key",
				"That password and key file don't open this database. One that also needs a YubiKey or a Windows account can't open here; export it to XML instead.",
			);
		case kdbxweb.Consts.ErrorCodes.BadSignature:
			return new KdbxOpenError(
				"not-kdbx",
				"That isn't a KeePass database. Choose the .kdbx file, or export to XML.",
			);
		case kdbxweb.Consts.ErrorCodes.InvalidVersion:
		case kdbxweb.Consts.ErrorCodes.Unsupported:
			return new KdbxOpenError(
				"unsupported",
				"vauly can't open this kind of KeePass database. Export it to XML instead.",
			);
		default:
			return new KdbxOpenError(
				"corrupt",
				"That database couldn't be read. It may be damaged; export it to XML instead.",
			);
	}
}

/** The database as KeePass XML, protected values included, as KeePass's own export has it. */
export async function openKdbx(
	file: ArrayBuffer,
	password: string,
	keyFile?: ArrayBuffer,
): Promise<string> {
	if (file.byteLength > KDBX_LIMITS.fileSize) {
		throw new KdbxOpenError(
			"too-costly",
			"That database is bigger than vauly's import takes (100 MB). Export it to XML instead.",
		);
	}
	checkHeader(file);
	try {
		const credentials = new kdbxweb.KdbxCredentials(
			password ? kdbxweb.ProtectedValue.fromString(password) : null,
			keyFile ?? null,
		);
		const db = await kdbxweb.Kdbx.load(file, credentials);
		// kdbxweb writes its own name as the generator; the import reads the app's there.
		const generator = db.meta.generator ?? "";
		const xml = await db.saveXml();
		return xml.replace(
			/<Generator>[^<]*<\/Generator>/,
			`<Generator>${escapeXml(generator)}</Generator>`,
		);
	} catch (error) {
		throw failure(error);
	}
}

const escapeXml = (text: string) =>
	text.replace(
		/[<>&"']/g,
		(char) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				'"': "&quot;",
				"'": "&apos;",
			})[char] ?? char,
	);
