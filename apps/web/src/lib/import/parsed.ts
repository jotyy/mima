import type { ItemFields } from "../vault-data";
import { type Draft, toItem } from "./item";

export type ImportSource =
	| "vauly"
	| "1Password"
	| "Bitwarden"
	| "LastPass"
	| "Dashlane"
	| "Keeper"
	| "NordPass"
	| "RoboForm"
	| "Proton Pass"
	| "KeePass"
	| "KeePassXC"
	| "Enpass"
	| "Apple Passwords"
	| "Chrome"
	| "Firefox"
	| "CSV";

/** What a file holds that vauly doesn't bring over, so the review can say so. */
export type Leftover =
	| "card"
	| "identity"
	| "record"
	| "alias"
	| "passkey"
	| "attachment"
	| "trashed"
	| "empty";

/** A file that comes with an item; `data` is filled in from the ZIP that holds it. */
export type ImportedFile = { name: string; path: string; data?: Uint8Array };

export type ParsedImport = {
	source: ImportSource;
	/** How the file was read: "1PUX", "JSON", "CSV", "XML" or "ZIP". */
	format: string;
	items: ItemFields[];
	left: Partial<Record<Leftover, number>>;
	/** Folders, vaults or collections, which come over as tags. */
	folders: string[];
	/** The files each item brings, from a vauly backup ZIP. */
	files?: Map<ItemFields, ImportedFile[]>;
};

export class ImportError extends Error {}

/**
 * A file that its app protected with a password: thrown where the format is found, with
 * what opens it. The import dialog asks for the password and calls `open`, which throws
 * WrongPasswordError (./protected.ts) for a wrong one, so it can ask again.
 */
export class LockedExport extends Error {
	constructor(
		readonly app: "Bitwarden" | "Proton Pass",
		readonly open: (
			password: string,
			argon2?: import("./protected").Argon2Lanes,
		) => Promise<ParsedImport>,
	) {
		super(`That ${app} export is protected with a password.`);
	}
}

/** Gathers the items a format reads, and counts what it leaves behind. */
export function collect(source: ImportSource, format: string) {
	const result: ParsedImport = {
		source,
		format,
		items: [],
		left: {},
		folders: [],
	};
	const folders = new Set<string>();
	/** "skip" is for rows that aren't items at all, like folders and bookmarks. */
	const leave = (reason: Leftover | "skip", count = 1) => {
		if (reason !== "skip" && count > 0) {
			result.left[reason] = (result.left[reason] ?? 0) + count;
		}
	};
	return {
		result,
		leave,
		add({ folder, files, ...draft }: Draft) {
			const path = folder?.trim();
			// An item that holds nothing but files still comes over, for them.
			const item =
				toItem(
					path ? { ...draft, tags: [path, ...(draft.tags ?? [])] } : draft,
				) ??
				(files?.length
					? { kind: "note" as const, name: draft.name?.trim() || "Files" }
					: null);
			if (!item) return leave("empty");
			result.items.push(item);
			if (files?.length) {
				result.files ??= new Map();
				result.files.set(
					item,
					files.map((file) => ({
						path: file,
						name: file.split("/").pop() || "file",
					})),
				);
			}
			if (path && !folders.has(path)) {
				folders.add(path);
				result.folders.push(path);
			}
		},
	};
}
