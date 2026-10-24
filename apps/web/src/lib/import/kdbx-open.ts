import { argon2d, argon2id } from "hash-wasm";
import * as kdbxweb from "kdbxweb";

import {
	KDBX_LIMITS,
	keyFileTooBig,
	tooBig,
	tooCostly as tooCostlyMessage,
	unpacksTooBig,
} from "./kdbx-limits";

// Opens a KeePass database (.kdbx, versions 3.1 and 4) with its password and key file,
// and hands it back as KeePass XML, held in memory only, for the XML import to read.
// It runs in the import worker (kdbx.worker.ts), which may compile WebAssembly, as the
// page may not, and can't connect anywhere. A database says how hard its key is to
// derive: one that asks for more than a database needs is refused before anything runs.
// What it unpacks to is capped as well (kdbxweb is patched for that: patches/), and its
// attachments are taken out and sent beside the XML, as bytes, rather than in it.

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
	new KdbxOpenError("too-costly", tooCostlyMessage(what));

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
		// patches/kdbxweb@2.1.1.patch: past KDBX_LIMITS.unpacked, nothing more is unpacked.
		case "InflateLimit":
			return new KdbxOpenError("too-costly", unpacksTooBig);
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

/** An entry's attachment: its bytes, or only its size when it's over the file limit. */
export type KdbxAttachment = {
	/** The entry's UUID, as the XML's <UUID> has it. */
	entry: string;
	name: string;
	size: number;
	data?: ArrayBuffer;
};

/**
 * The database as KeePass XML, protected values included, as KeePass's own export has it,
 * and its attachments beside it. Those over `fileLimit` come without their bytes, so the
 * import can name them.
 */
export async function openKdbx(
	file: ArrayBuffer,
	password: string,
	keyFile?: ArrayBuffer,
	fileLimit = Number.POSITIVE_INFINITY,
): Promise<{ xml: string; files: KdbxAttachment[] }> {
	if (file.byteLength > KDBX_LIMITS.fileSize) {
		throw new KdbxOpenError("too-costly", tooBig);
	}
	checkHeader(file);
	const key = keyFile ? await keyFileKey(keyFile) : null;
	try {
		const db = await load(file, password, key);
		const files = takeAttachments(db, fileLimit);
		// kdbxweb writes its own name as the generator; the import reads the app's there.
		const generator = db.meta.generator ?? "";
		const xml = await db.saveXml();
		return {
			files,
			xml: xml.replace(
				/<Generator>[^<]*<\/Generator>/,
				`<Generator>${escapeXml(generator)}</Generator>`,
			),
		};
	} catch (error) {
		throw failure(error);
	}
}

/**
 * Loads the database, with what it may unpack capped for each try. With a key file and
 * no password, KeePassXC leaves the password out of the key, and KeePass may count an
 * empty one: both are tried, as KeePassXC does.
 */
async function load(
	file: ArrayBuffer,
	password: string,
	key: ArrayBuffer | null,
) {
	const attempt = (withPassword: boolean) => {
		kdbxweb.setInflateLimit(KDBX_LIMITS.unpacked);
		return kdbxweb.Kdbx.load(
			file,
			new kdbxweb.KdbxCredentials(
				withPassword ? kdbxweb.ProtectedValue.fromString(password) : null,
				// A copy for each try: kdbxweb protects the key it's given in place.
				key?.slice(0) ?? null,
			),
		);
	};
	if (password || !key) return attempt(true);
	try {
		return await attempt(false);
	} catch (error) {
		const code = error instanceof kdbxweb.KdbxError ? error.code : "";
		if (code !== kdbxweb.Consts.ErrorCodes.InvalidKey) throw error;
		return attempt(true);
	}
}

/**
 * Takes every attachment out before the database is written as XML, which would carry
 * each one as base64, and keeps those on entries the import brings: not the Recycle
 * Bin's or the templates'. Earlier versions' attachments go, as the import brings only
 * an entry's earlier passwords. Custom icons go as well: unused.
 */
function takeAttachments(db: kdbxweb.Kdbx, fileLimit: number) {
	const skipped = new Set<kdbxweb.KdbxEntry>();
	for (const uuid of [db.meta.recycleBinUuid, db.meta.entryTemplatesGroup]) {
		const group = uuid ? db.getGroup(uuid) : undefined;
		for (const entry of group?.allEntries() ?? []) skipped.add(entry);
	}
	const files: KdbxAttachment[] = [];
	for (const group of db.groups) {
		for (const entry of group.allEntries()) {
			for (const [name, binary] of skipped.has(entry) ? [] : entry.binaries) {
				const bytes = binaryBytes(binary);
				if (!bytes) continue;
				const size = bytes.byteLength;
				files.push({
					entry: entry.uuid.id,
					name,
					size,
					// A copy of its own for each: entries can share one, and each is moved to the page.
					...(size <= fileLimit && { data: bytes.slice().buffer }),
				});
			}
			entry.binaries.clear();
			for (const earlier of entry.history) earlier.binaries.clear();
		}
	}
	db.binaries = new kdbxweb.KdbxBinaries();
	db.meta.customIcons.clear();
	return files;
}

function binaryBytes(
	binary:
		| kdbxweb.KdbxBinary
		| kdbxweb.KdbxBinaryWithHash
		| kdbxweb.KdbxBinaryRef,
): Uint8Array | undefined {
	if (binary instanceof kdbxweb.ProtectedValue) return binary.getBinary();
	if (binary instanceof ArrayBuffer) return new Uint8Array(binary);
	return "value" in binary ? binaryBytes(binary.value) : undefined;
}

/**
 * The 32 bytes a key file stands for, as KeePass reads one: a KeePass XML key file's
 * key (version 1 or 2, its check verified when it has one), 32 bytes as they are, 64
 * hex characters, or else the SHA-256 of the whole file, whatever it is.
 */
export async function keyFileKey(keyFile: ArrayBuffer): Promise<ArrayBuffer> {
	if (keyFile.byteLength > KDBX_LIMITS.keyFileSize) {
		throw new KdbxOpenError("too-costly", keyFileTooBig);
	}
	const bytes = new Uint8Array(keyFile);
	const fromXml = await xmlKeyFile(bytes);
	if (fromXml) return fromXml;
	if (bytes.byteLength === 32) return keyFile.slice(0);
	if (bytes.byteLength === 64) {
		const text = new TextDecoder().decode(bytes);
		if (/^[a-f\d]{64}$/i.test(text))
			return copy(kdbxweb.ByteUtils.hexToBytes(text));
	}
	return crypto.subtle.digest("SHA-256", bytes);
}

const copy = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;

/** A KeePass XML key file's key, or undefined for any other file, which is hashed. */
async function xmlKeyFile(bytes: Uint8Array) {
	let root: Element | null;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
		if (!text.startsWith("<")) return undefined;
		root = kdbxweb.XmlUtils.parse(text).documentElement;
	} catch {
		return undefined;
	}
	if (root?.nodeName !== "KeyFile") return undefined;
	const child = (node: Node | null, name: string) =>
		node ? kdbxweb.XmlUtils.getChildNode(node, name) : null;
	const version = child(child(root, "Meta"), "Version")?.textContent?.trim();
	const data = child(child(root, "Key"), "Data") as Element | null;
	const text = data?.textContent?.replace(/\s+/g, "");
	if (!version || !data || !text) return undefined;
	const major = version.split(".")[0];
	if (major === "1") {
		const key = kdbxweb.ByteUtils.base64ToBytes(text);
		return key.byteLength === 32 ? copy(key) : undefined;
	}
	if (major !== "2" || !/^[a-f\d]{64}$/i.test(text)) return undefined;
	const key = copy(kdbxweb.ByteUtils.hexToBytes(text));
	// Its first four bytes of SHA-256, when it has them, catch a key typed in wrong.
	const check = data.getAttribute("Hash")?.trim();
	if (check) {
		const digest = await crypto.subtle.digest("SHA-256", key);
		const expected = kdbxweb.ByteUtils.bytesToHex(
			new Uint8Array(digest).subarray(0, 4),
		);
		if (check.toLowerCase() !== expected.toLowerCase()) {
			throw new KdbxOpenError(
				"corrupt",
				"That key file is damaged: its check doesn't match its key. Choose a backup of the key file.",
			);
		}
	}
	return key;
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
