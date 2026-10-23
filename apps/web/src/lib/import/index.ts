import { unzipSync } from "fflate";

import type { ItemFields } from "../vault-data";
import { parseCsvExport, parseDashlane } from "./csv";
import { parseJsonExport } from "./json";
import { parseKeePassXml } from "./keepass";
import { ImportError, type ParsedImport } from "./parsed";
import { decodeEntities } from "./xml";

// Reads the exports of other password managers and browsers into item fields. The format
// comes from the file's contents, not its name. Everything here runs on this device: the
// file is never uploaded as it is.

export { parseCsv } from "./csv";
export {
	ImportError,
	type ImportSource,
	type Leftover,
	type ParsedImport,
} from "./parsed";

export async function readImportFile(file: File): Promise<ParsedImport> {
	return readImport(new Uint8Array(await file.arrayBuffer()));
}

export function readImport(bytes: Uint8Array): ParsedImport {
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return readZip(bytes);
	if (startsWith(bytes, [0x03, 0xd9, 0xa2, 0x9a])) {
		throw new ImportError(
			"That's an encrypted KeePass database. Export it as XML from KeePass, or as CSV from KeePassXC.",
		);
	}
	return parseImport(decodeText(bytes));
}

export function parseImport(text: string): ParsedImport {
	const start = text.replace(/^﻿/, "").trimStart();
	if (start.startsWith("-----BEGIN PGP")) {
		throw new ImportError(
			"That export is encrypted. Export again without encryption.",
		);
	}
	if (start.startsWith("{") || start.startsWith("[")) {
		let data: unknown;
		try {
			data = JSON.parse(start);
		} catch {
			throw new ImportError("That JSON file couldn't be read.");
		}
		return parseJsonExport(data);
	}
	// LastPass's web vault can show its CSV in a web page, which people save as it is.
	const page =
		/^<(!doctype html|html)[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(start);
	if (page?.[2]) return parseCsvExport(decodeEntities(page[2]));
	if (start.startsWith("<")) return parseKeePassXml(start);
	return parseCsvExport(text);
}

/** Attachments that some ZIP exports carry beside the items, which stay packed. */
const attachment = /(^|\/)(files|attachments)\/./;

/**
 * 1Password's .1pux, a Proton Pass or Bitwarden ZIP, Dashlane's CSV ZIP, Safari's
 * browsing data, or a ZIP around one export.
 */
function readZip(bytes: Uint8Array): ParsedImport {
	const names: string[] = [];
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes, {
			filter: (file) => {
				names.push(file.name);
				return (
					!attachment.test(file.name) &&
					!file.name.startsWith("__MACOSX/") &&
					/\.(json|csv|xml|data|pgp)$/i.test(file.name)
				);
			},
		});
	} catch {
		throw new ImportError("That ZIP file couldn't be opened.");
	}
	const text = (name: string) => decodeText(files[name] ?? new Uint8Array());
	const base = (name: string) => name.split("/").pop()?.toLowerCase() ?? "";
	const attachments = names.filter(
		(name) => attachment.test(name) && !name.endsWith("/"),
	).length;
	const entries = Object.keys(files);

	if (files["export.data"]) {
		const parsed = parseImport(text("export.data"));
		return withAttachments({ ...parsed, format: "1PUX" }, attachments);
	}
	if (entries.some((name) => name.endsWith(".pgp"))) {
		throw new ImportError(
			"That export is encrypted. In Proton Pass, export again and choose ZIP, not PGP-encrypted.",
		);
	}
	const dashlane = entries.filter((name) =>
		/^(credentials|securenotes|payments|ids|personalinfo)\.csv$/.test(
			base(name),
		),
	);
	if (dashlane.some((name) => base(name) === "credentials.csv")) {
		return parseDashlane(
			Object.fromEntries(dashlane.map((name) => [base(name), text(name)])),
		);
	}
	// Proton Pass and Bitwarden keep their items in data.json; Safari in Passwords.csv,
	// beside its bookmarks and history.
	const only =
		entries.find((name) => base(name) === "data.json") ??
		entries.find((name) => /password/i.test(base(name))) ??
		(entries.length === 1 ? entries[0] : undefined);
	if (!only) {
		throw new ImportError(
			"That ZIP isn't an export vauly knows. Unpack it and choose the export inside.",
		);
	}
	const parsed = parseImport(text(only));
	return withAttachments(
		{ ...parsed, format: parsed.format === "JSON" ? "ZIP" : parsed.format },
		attachments,
	);
}

function withAttachments(parsed: ParsedImport, count: number): ParsedImport {
	if (count === 0) return parsed;
	return {
		...parsed,
		left: { ...parsed.left, attachment: (parsed.left.attachment ?? 0) + count },
	};
}

/** UTF-8, or UTF-16 when the file starts with its byte order mark. */
export function decodeText(bytes: Uint8Array) {
	if (startsWith(bytes, [0xff, 0xfe])) {
		return new TextDecoder("utf-16le").decode(bytes);
	}
	if (startsWith(bytes, [0xfe, 0xff])) {
		return new TextDecoder("utf-16be").decode(bytes);
	}
	return new TextDecoder().decode(bytes);
}

function startsWith(bytes: Uint8Array, prefix: number[]) {
	return prefix.every((byte, index) => bytes[index] === byte);
}

/** Items that look the same as one already in the vault: same kind, name, username and secret. */
export function sameItem(a: ItemFields, b: ItemFields) {
	return (
		a.kind === b.kind &&
		a.name.toLowerCase() === b.name.toLowerCase() &&
		(a.username ?? "") === (b.username ?? "") &&
		(a.secret ?? "") === (b.secret ?? "") &&
		(a.notes ?? "") === (b.notes ?? "")
	);
}
