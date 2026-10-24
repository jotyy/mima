import { unzipSync } from "fflate";

import type { ItemFields } from "../vault-data";
import { parseCsvExport, parseDashlane } from "./csv";
import { parseJsonExport } from "./json";
import { openKdbxInWorker } from "./kdbx";
import { checkKdbxHeader } from "./kdbx-header";
import { type KeePassFile, parseKeePassXml } from "./keepass";
import { ImportError, LockedExport, type ParsedImport } from "./parsed";
import {
	type Argon2Lanes,
	checkBitwardenExport,
	isBitwardenProtected,
	openBitwardenExport,
	openFile,
	openProtonPass,
	type SealedFile,
	sealedFileOf,
	sealedSize,
} from "./protected";
import { decodeEntities } from "./xml";

// Reads the exports of other password managers and browsers into item fields. The format
// comes from the file's contents, not its name. Everything here runs on this device: the
// file is never uploaded as it is.

export { parseCsv } from "./csv";
export {
	fileBytes,
	ImportError,
	type ImportedFile,
	type ImportSource,
	type Leftover,
	LockedExport,
	type OpenWith,
	type ParsedImport,
} from "./parsed";
export { WrongPasswordError } from "./protected";

/** Argon2id with lanes in the key worker, loaded only when a file needs it. */
const keyWorker: Argon2Lanes = async (...args) =>
	(await import("../argon2")).argon2LanesInWorker(...args);

export async function readImportFile(file: File): Promise<ParsedImport> {
	return readImport(new Uint8Array(await file.arrayBuffer()));
}

export function readImport(bytes: Uint8Array): ParsedImport {
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return readZip(bytes);
	if (startsWith(bytes, [0x03, 0xd9, 0xa2, 0x9a])) {
		// A KeePass database: refused now if it asks too much, else opened in a worker with
		// its password and key file, then read as KeePass's XML export is.
		checkKdbxHeader(bytes);
		throw new LockedExport("KeePass", async (password, more) => {
			const { xml, files } = await openKdbxInWorker(
				bytes.slice().buffer,
				password,
				more,
			);
			const byEntry = new Map<string, KeePassFile[]>();
			for (const { entry, name, size, data } of files) {
				const file = { name, size, data: data && new Uint8Array(data) };
				byEntry.set(entry, [...(byEntry.get(entry) ?? []), file]);
			}
			return { ...parseKeePassXml(xml, byEntry), format: "KDBX" };
		});
	}
	return parseImport(decodeText(bytes));
}

export function parseImport(text: string): ParsedImport {
	const start = text.replace(/^﻿/, "").trimStart();
	if (start.startsWith("-----BEGIN PGP")) {
		// Proton Pass's data.pgp, taken out of its ZIP, or an older export: the whole ZIP.
		throw new LockedExport("Proton Pass", async (password) => {
			const opened = await openProtonPass(start, password);
			return startsWith(opened, [0x50, 0x4b, 0x03, 0x04])
				? readZip(opened)
				: parseImport(decodeText(opened));
		});
	}
	if (start.startsWith("{") || start.startsWith("[")) {
		let data: unknown;
		try {
			data = JSON.parse(start);
		} catch {
			throw new ImportError("That JSON file couldn't be read.");
		}
		if (
			data &&
			typeof data === "object" &&
			isBitwardenProtected(data as Record<string, unknown>)
		) {
			const root = data as Record<string, unknown>;
			// A file vauly won't open is refused now, not after its password.
			checkBitwardenExport(root);
			throw new LockedExport(
				root.vauly === 1 ? "vauly" : "Bitwarden",
				async (password, { argon2 = keyWorker } = {}) =>
					parseImport(await openBitwardenExport(root, password, argon2)),
			);
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
	);
	const entries = Object.keys(files);

	const sealedBackup = entries.find((name) =>
		/^vauly-backup[^/]*\.json$/.test(name),
	);
	if (sealedBackup)
		return readSealedBackupZip(bytes, text(sealedBackup), attachments);
	const backup = entries.find((name) => /^vauly-backup[^/]*\.csv$/.test(name));
	if (backup) {
		return packFiles(
			{ ...parseImport(text(backup)), format: "ZIP" },
			bytes,
			attachments,
		);
	}
	if (files["export.data"]) {
		const parsed = parseImport(text("export.data"));
		return packFiles(
			{ ...parsed, format: "1PUX" },
			bytes,
			attachments,
			(path) => onePuxEntry(path, attachments),
		);
	}
	// Proton Pass's export with encryption on: its data.json, encrypted, as data.pgp.
	const sealed = entries.find((name) => base(name) === "data.pgp");
	if (sealed) {
		throw new LockedExport("Proton Pass", async (password) => {
			const opened = await openProtonPass(text(sealed), password);
			const parsed = parseImport(decodeText(opened));
			return withAttachments({ ...parsed, format: "ZIP" }, attachments.length);
		});
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
	const zipped = {
		...parsed,
		format: parsed.format === "JSON" ? "ZIP" : parsed.format,
	};
	if (parsed.source === "Bitwarden") {
		return packFiles(bitwardenFiles(zipped, attachments), bytes, attachments);
	}
	return withAttachments(zipped, attachments.length);
}

/**
 * Reads the files the items name out of the ZIP, where `find` says each one is. Whatever
 * else the ZIP keeps beside the items, or names but lacks, is counted as left behind.
 */
function packFiles(
	parsed: ParsedImport,
	bytes: Uint8Array,
	attachments: string[],
	find = (path: string): string | undefined => path,
): ParsedImport {
	if (!parsed.files) return withAttachments(parsed, attachments.length);
	const where = new Map(
		[...parsed.files.values()]
			.flat()
			.map((file) => [file.path, find(file.path)] as const),
	);
	const wanted = new Set([...where.values()].filter(Boolean));
	const packed = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
	let attached = 0;
	const files = new Map(
		[...parsed.files].map(([item, list]) => [
			item,
			list.flatMap((file) => {
				const data = packed[where.get(file.path) ?? ""];
				if (!data) return [];
				attached++;
				return [{ ...file, data }];
			}),
		]),
	);
	return withAttachments(
		{ ...parsed, files },
		Math.max(0, attachments.length - attached),
	);
}

/**
 * Where a 1PUX keeps a file: `files/<document ID>__<file name>`, or, if the name was
 * changed on the way, the one file under that document ID.
 */
function onePuxEntry(path: string, entries: string[]) {
	if (entries.includes(path)) return path;
	const id = path.slice("files/".length).split("__")[0];
	return id
		? entries.find((entry) => entry.startsWith(`files/${id}_`))
		: undefined;
}

/**
 * Bitwarden's ZIP keeps an item's attachments in a folder named after it, as
 * attachments/<item name>/<file>, with characters a folder can't have made `_` and a
 * number added when names repeat. Its data.json doesn't say which items have files, so
 * a folder goes to an item only when exactly one item has that name; the others stay
 * behind, counted.
 */
function bitwardenFiles(
	parsed: ParsedImport,
	attachments: string[],
): ParsedImport {
	const folderName = (name: string) =>
		name.replace(/[/\\><:"|?*]/g, "_").replace(/__+/g, "_");
	const byName = new Map<string, ParsedImport["items"]>();
	for (const item of parsed.items) {
		const name = folderName(item.name);
		byName.set(name, [...(byName.get(name) ?? []), item]);
	}
	const files = new Map(parsed.files);
	for (const path of attachments) {
		const [, folder = "", ...rest] = path.split("/");
		const owners = byName.get(folder);
		const name = rest.join("/");
		if (owners?.length !== 1 || !owners[0] || !name) continue;
		files.set(owners[0], [...(files.get(owners[0]) ?? []), { name, path }]);
	}
	return files.size > 0 ? { ...parsed, files } : parsed;
}

/**
 * A vauly backup protected with a password, with files: the password-protected export,
 * and each file sealed with a key of its own at files/<n>, without its name. Only the
 * export holds the names (as files/<n>/<name>), and each file's key, size and SHA-256.
 * Only the files it lists are unpacked, each only if the ZIP gives the size it should
 * have, and every one must be there and match.
 */
function readSealedBackupZip(
	bytes: Uint8Array,
	json: string,
	attachments: string[],
): ParsedImport {
	let root: unknown;
	try {
		root = JSON.parse(json);
	} catch {
		throw new ImportError("That backup couldn't be read.");
	}
	if (!root || typeof root !== "object" || Array.isArray(root))
		throw new ImportError("That backup couldn't be read.");
	const backup = root as Record<string, unknown>;
	if (!isBitwardenProtected(backup))
		return packFiles(
			{ ...parseImport(json), format: "ZIP" },
			bytes,
			attachments,
		);
	checkBitwardenExport(backup);
	const changed = () =>
		new ImportError(
			"That backup was changed after it was made, so vauly won't open it.",
		);
	throw new LockedExport(
		"vauly",
		async (password, { argon2 = keyWorker } = {}) => {
			const opened = await openBitwardenExport(backup, password, argon2);
			const parsed = parseImport(opened);
			if (!parsed.files) return { ...parsed, format: "ZIP" };
			const listed = Object(
				(JSON.parse(opened) as { vaulyFiles?: unknown }).vaulyFiles,
			) as Record<string, unknown>;
			const slot = (path: string) => path.split("/").slice(0, 2).join("/");
			const about = new Map<string, SealedFile>();
			for (const list of parsed.files.values())
				for (const file of list) {
					const known = sealedFileOf(listed[slot(file.path)]);
					if (!known) throw changed();
					about.set(slot(file.path), known);
				}
			const packed = unzipSync(bytes, {
				filter: (file) => {
					const known = about.get(file.name);
					return Boolean(known && file.originalSize === sealedSize(known.size));
				},
			});
			const files: NonNullable<ParsedImport["files"]> = new Map();
			for (const [item, list] of parsed.files) {
				const done: typeof list = [];
				for (const file of list) {
					const sealed = packed[slot(file.path)];
					const known = about.get(slot(file.path));
					const data = sealed && known && (await openFile(sealed, known));
					if (!data) throw changed();
					done.push({ ...file, data });
				}
				files.set(item, done);
			}
			return { ...parsed, format: "ZIP", files };
		},
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
