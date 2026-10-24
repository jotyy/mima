import { gunzipSync } from "fflate";

import type { PreviousSecret } from "../vault-data";
import { type Field, isoDate, splitTags } from "./item";
import { KDBX_LIMITS } from "./kdbx-limits";
import { collect, ImportError, type ParsedImport } from "./parsed";
import { child, children, parseXml, type XmlNode } from "./xml";

// KeePass 2's XML export, which KeePassXC also writes, and what the import worker makes
// of a .kdbx database. Groups nest; their names become a folder path. The Recycle Bin,
// the entry templates and each entry's own history (its earlier versions) are left out,
// though earlier passwords come along. Attachments come as files.

const standard = ["Title", "UserName", "Password", "URL", "Notes"];

/** An attachment: its bytes, or only its size when it's too big to have been sent. */
export type KeePassFile = { name: string; size: number; data?: Uint8Array };

/**
 * Reads the XML. A database's attachments come from the import worker (kdbx-open.ts),
 * by entry UUID, as `opened`; an XML export's are in the XML itself.
 */
export function parseKeePassXml(
	text: string,
	opened?: Map<string, KeePassFile[]>,
): ParsedImport {
	let file: XmlNode;
	try {
		file = parseXml(text);
	} catch {
		throw new ImportError("That XML file couldn't be read.");
	}
	if (file.name !== "KeePassFile") {
		throw new ImportError(
			"That XML file isn't a KeePass export. Choose a KeePass XML (2.x) file.",
		);
	}
	const source = /KeePassXC/i.test(
		child(child(file, "Meta"), "Generator")?.text ?? "",
	)
		? "KeePassXC"
		: "KeePass";
	const { result, add, leave } = collect(source, "XML");
	const meta = child(file, "Meta");
	const recycleBin = child(meta, "RecycleBinUUID")?.text.trim();
	const templates = child(meta, "EntryTemplatesGroup")?.text.trim();
	const root = child(child(file, "Root"), "Group");
	if (!root) throw new ImportError("That KeePass export has no entries.");

	// Each attachment by where its item's file list says it is, to fill in once all are added.
	const found = new Map<string, KeePassFile>();
	const binaries = exportedBinaries(meta);
	const attachmentsOf = (entry: XmlNode) => {
		if (opened)
			return opened.get(child(entry, "UUID")?.text.trim() ?? "") ?? [];
		return children(entry, "Binary").flatMap((binary) => {
			const file = binaries(binary);
			if (!file) leave("attachment");
			return file ? [file] : [];
		});
	};

	const walk = (group: XmlNode, path: string[]) => {
		const uuid = child(group, "UUID")?.text.trim();
		if (recycleBin && uuid === recycleBin) {
			leave("trashed", countEntries(group));
			return;
		}
		if (templates && uuid === templates) return;
		for (const entry of children(group, "Entry")) {
			const { strings, protectedKeys } = readStrings(entry);
			const value = (key: string) => strings.get(key) ?? "";
			const fields: Field[] = [];
			for (const [key, text] of strings) {
				if (!standard.includes(key) && !isOtpKey(key) && text.trim()) {
					fields.push({
						label: key,
						value: text,
						hidden: protectedKeys.has(key),
					});
				}
			}
			const files = attachmentsOf(entry).map((attached) => {
				const path = `keepass/${found.size}`;
				found.set(path, attached);
				return { name: attached.name, path };
			});
			add({
				name: value("Title"),
				username: value("UserName"),
				secret: value("Password"),
				urls: [value("URL")],
				totp: totpOf(strings),
				notes: value("Notes"),
				tags: splitTags(child(entry, "Tags")?.text, /[;,]/),
				folder: path.join("/"),
				fields,
				history: historyOf(entry, value("Password")),
				files,
			});
		}
		for (const inner of children(group, "Group")) {
			walk(inner, [...path, child(inner, "Name")?.text.trim() ?? ""]);
		}
	};
	// The top group is the database itself, so its name isn't part of the path.
	walk(root, []);
	for (const list of result.files?.values() ?? []) {
		for (const file of list) {
			const attached = found.get(file.path);
			if (attached)
				Object.assign(file, { data: attached.data, size: attached.size });
		}
	}
	return result;
}

/**
 * An XML export keeps each attachment once, under Meta's Binaries, as base64 and often
 * compressed, and its entries refer to it by ID; older exports keep it in the entry.
 * What they all unpack to together is capped, as for a database (kdbx-limits.ts), and
 * checked before anything is unpacked: GZIP ends with the size it unpacks to.
 */
function exportedBinaries(meta: XmlNode | undefined) {
	const pool = new Map(
		children(child(meta, "Binaries"), "Binary").map((node) => [
			node.attrs.ID ?? "",
			node,
		]),
	);
	const unpacked = new Map<XmlNode, Uint8Array | null>();
	let left = KDBX_LIMITS.unpacked;
	const unpack = (node: XmlNode) => {
		if (unpacked.has(node)) return unpacked.get(node) ?? undefined;
		let bytes: Uint8Array | null;
		try {
			bytes = Uint8Array.from(atob(node.text.replace(/\s+/g, "")), (char) =>
				char.charCodeAt(0),
			);
			if (node.attrs.Compressed?.toLowerCase() === "true") {
				const size =
					bytes.length < 18
						? 0
						: new DataView(bytes.buffer).getUint32(bytes.length - 4, true);
				bytes = size <= left ? gunzipSync(bytes) : null;
			}
			if (bytes && bytes.length > left) bytes = null;
		} catch {
			bytes = null;
		}
		if (bytes) left -= bytes.length;
		unpacked.set(node, bytes);
		return bytes ?? undefined;
	};
	return (binary: XmlNode): KeePassFile | undefined => {
		const name = child(binary, "Key")?.text;
		const value = child(binary, "Value");
		const ref = value?.attrs.Ref;
		const source = ref === undefined ? value : pool.get(ref);
		const data = source && unpack(source);
		return name && data ? { name, size: data.length, data } : undefined;
	};
}

/** An entry's strings, and which of them KeePass protects, as it does its password. */
function readStrings(entry: XmlNode) {
	const strings = new Map<string, string>();
	const protectedKeys = new Set<string>();
	for (const string of children(entry, "String")) {
		const key = child(string, "Key")?.text;
		const value = child(string, "Value");
		if (!key) continue;
		strings.set(key, value?.text ?? "");
		if (value?.attrs.ProtectInMemory?.toLowerCase() === "true") {
			protectedKeys.add(key);
		}
	}
	return { strings, protectedKeys };
}

const isOtpKey = (key: string) =>
	key === "otp" ||
	key === "TOTP Seed" ||
	key === "TOTP Settings" ||
	key.startsWith("TimeOtp-");

/**
 * KeePassXC keeps an otpauth:// link under "otp" (or the KeeOtp plugin's "key=…"), older
 * entries a "TOTP Seed". KeePass 2.47+ keeps the secret in one of four encodings, with
 * its settings beside it.
 */
function totpOf(strings: Map<string, string>) {
	const otp = strings.get("otp")?.trim() ?? "";
	if (otp.startsWith("otpauth://")) return otp;
	if (otp) {
		const keeOtp = new URLSearchParams(otp);
		const key = keeOtp.get("key");
		if (!key) return otp;
		return totpUri(key, keeOtp.get("size"), keeOtp.get("step"), null);
	}
	const seed = strings.get("TOTP Seed")?.trim();
	if (seed) {
		const [period, digits] = (strings.get("TOTP Settings") ?? "").split(";");
		return totpUri(seed, digits === "S" ? null : digits, period, null);
	}
	const secret =
		strings.get("TimeOtp-Secret-Base32") ??
		fromBytes(strings.get("TimeOtp-Secret-Hex"), "hex") ??
		fromBytes(strings.get("TimeOtp-Secret-Base64"), "base64") ??
		fromBytes(strings.get("TimeOtp-Secret"), "text");
	if (!secret) return "";
	return totpUri(
		secret,
		strings.get("TimeOtp-Length"),
		strings.get("TimeOtp-Period"),
		strings.get("TimeOtp-Algorithm")?.replace("HMAC-", "").replace("-", ""),
	);
}

function totpUri(
	secret: string,
	digits?: string | null,
	period?: string | null,
	algorithm?: string | null,
) {
	const clean = secret.replace(/[\s=]/g, "").toUpperCase();
	if (!digits && !period && !algorithm) return clean;
	const params = new URLSearchParams({ secret: clean });
	if (digits) params.set("digits", digits);
	if (period) params.set("period", period);
	if (algorithm) params.set("algorithm", algorithm);
	return `otpauth://totp/?${params}`;
}

/** A secret given as hex, base64 or plain text, as base32. */
function fromBytes(
	value: string | undefined,
	encoding: "hex" | "base64" | "text",
) {
	if (!value?.trim()) return undefined;
	let bytes: Uint8Array;
	try {
		bytes =
			encoding === "hex"
				? Uint8Array.from(value.replace(/\s/g, "").match(/../g) ?? [], (pair) =>
						Number.parseInt(pair, 16),
					)
				: encoding === "base64"
					? Uint8Array.from(atob(value.trim()), (char) => char.charCodeAt(0))
					: new TextEncoder().encode(value);
	} catch {
		return undefined;
	}
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = 0;
	let buffer = 0;
	let out = "";
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += alphabet[(buffer >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];
	return out;
}

/** Earlier passwords, newest first, each dated when it stopped being the password. */
function historyOf(entry: XmlNode, current: string): PreviousSecret[] {
	const changed = (version: XmlNode) =>
		keePassTime(child(child(version, "Times"), "LastModificationTime")?.text);
	// Oldest first, then the entry as it is now.
	const versions = [
		...children(child(entry, "History"), "Entry").map((version) => ({
			secret: readStrings(version).strings.get("Password") ?? "",
			changed: changed(version),
		})),
		{ secret: current, changed: changed(entry) },
	];
	const history: PreviousSecret[] = [];
	for (let i = 0; i + 1 < versions.length; i++) {
		const version = versions[i];
		const next = versions[i + 1];
		// A password stopped being one when the version after it was saved.
		if (version?.secret && next && version.secret !== next.secret) {
			history.unshift({
				secret: version.secret,
				until: isoDate(next.changed || version.changed),
			});
		}
	}
	return history;
}

/**
 * KeePass writes times as ISO text. KeePassXC, for KDBX 4 databases, writes base64 of a
 * little-endian count of seconds since 0001-01-01.
 */
export function keePassTime(value: string | undefined) {
	const text = value?.trim() ?? "";
	if (!text || /^\d{4}-/.test(text)) return text;
	try {
		const bytes = Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
		if (bytes.length !== 8) return "";
		const seconds = new DataView(bytes.buffer).getBigInt64(0, true);
		// 0001-01-01 is 62,135,596,800 seconds before 1970.
		return new Date((Number(seconds) - 62_135_596_800) * 1000).toISOString();
	} catch {
		return "";
	}
}

function countEntries(group: XmlNode): number {
	return (
		children(group, "Entry").length +
		children(group, "Group").reduce(
			(sum, inner) => sum + countEntries(inner),
			0,
		)
	);
}
