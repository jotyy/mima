import { KDBX_LIMITS, tooBig, tooCostly } from "./kdbx-limits";
import { ImportError } from "./parsed";

// Reads a KeePass database's header on the page, without kdbxweb, so a file whose key
// settings ask for more than the import allows is refused before its password is asked
// for. The import worker checks them again, with kdbxweb, before it derives anything.
// Anything this can't make sense of is left for the worker to explain.

const AES_KDF = "c9d9f39a628a4460bf740d08c18a4fea";
const ARGON2 = [
	"ef636ddf8c29444b91f7a9a403e30a0c",
	"9e298b1956db4773b23dfc3ec6f0a1e6",
];

/** Throws an ImportError if the database is one vauly won't open; the password comes next. */
export function checkKdbxHeader(bytes: Uint8Array) {
	if (bytes.byteLength > KDBX_LIMITS.fileSize) throw new ImportError(tooBig);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (bytes.byteLength < 12) return;
	if (view.getUint32(4, true) === 0xb54bfb65) {
		throw new ImportError(
			"That's a KeePass 1 database (.kdb), which vauly can't open. Open it in KeePass 2, save it as .kdbx, and try again; or export to XML.",
		);
	}
	const major = view.getUint16(10, true);
	if (major === 2) {
		throw new ImportError(
			"That database is in KeePass's format from before 2012 (KDBX 2), which vauly can't open. Open it in a current KeePass or KeePassXC, save it, and try again; or export to XML.",
		);
	}
	if (major !== 3 && major !== 4) return;
	let at = 12;
	while (at < bytes.byteLength) {
		const id = bytes[at] ?? 0;
		const sizeLength = major === 4 ? 4 : 2;
		if (at + 1 + sizeLength > bytes.byteLength) return;
		const size =
			major === 4 ? view.getUint32(at + 1, true) : view.getUint16(at + 1, true);
		const start = at + 1 + sizeLength;
		if (start + size > bytes.byteLength) return;
		if (id === 0) return;
		if (id === 6 && major === 3 && size === 8) {
			checkRounds(view.getBigUint64(start, true));
		}
		if (id === 11 && major === 4) {
			checkKdf(readVariants(bytes.subarray(start, start + size)));
		}
		at = start + size;
	}
}

function checkRounds(rounds: bigint) {
	if (rounds > BigInt(KDBX_LIMITS.aesRounds)) {
		throw new ImportError(
			tooCostly(`${rounds.toLocaleString("en")} AES-KDF rounds`),
		);
	}
}

function checkKdf(params: Map<string, bigint | Uint8Array>) {
	const id = params.get("$UUID");
	if (!(id instanceof Uint8Array)) return;
	const kdf = Array.from(id, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
	const number = (key: string) => {
		const value = params.get(key);
		return typeof value === "bigint" ? value : undefined;
	};
	if (kdf === AES_KDF) {
		const rounds = number("R");
		if (rounds !== undefined) checkRounds(rounds);
		return;
	}
	if (!ARGON2.includes(kdf)) return;
	const memory = number("M");
	const passes = number("I");
	const lanes = number("P");
	if (memory !== undefined && memory / 1024n > BigInt(KDBX_LIMITS.memory)) {
		throw new ImportError(
			tooCostly(`${memory / 1024n / 1024n} MiB of memory to open`),
		);
	}
	if (passes !== undefined && passes > BigInt(KDBX_LIMITS.passes)) {
		throw new ImportError(tooCostly(`${passes} Argon2 passes`));
	}
	if (lanes !== undefined && lanes > BigInt(KDBX_LIMITS.lanes)) {
		throw new ImportError(tooCostly(`${lanes} Argon2 lanes`));
	}
}

/** KDBX 4's VarDictionary: numbers as bigints, everything else as bytes. */
function readVariants(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const values = new Map<string, bigint | Uint8Array>();
	let at = 2;
	while (at + 9 <= bytes.byteLength) {
		const type = bytes[at] ?? 0;
		if (type === 0) break;
		const nameLength = view.getUint32(at + 1, true);
		const nameEnd = at + 5 + nameLength;
		if (nameEnd + 4 > bytes.byteLength) break;
		const name = new TextDecoder().decode(bytes.subarray(at + 5, nameEnd));
		const length = view.getUint32(nameEnd, true);
		const start = nameEnd + 4;
		if (start + length > bytes.byteLength) break;
		values.set(
			name,
			type === 0x04 && length === 4
				? BigInt(view.getUint32(start, true))
				: type === 0x05 && length === 8
					? view.getBigUint64(start, true)
					: bytes.subarray(start, start + length),
		);
		at = start + length;
	}
	return values;
}
