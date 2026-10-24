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

/**
 * A file that comes with an item; `data` is filled in from the ZIP or database that holds
 * it. A file over this vauly's limit may come with only its `size`, for the review to name.
 */
export type ImportedFile = {
	name: string;
	path: string;
	data?: Uint8Array;
	size?: number;
};

/** A file's size, whether its bytes came along or not. */
export const fileBytes = (file: ImportedFile) =>
	file.size ?? file.data?.length ?? 0;

export type ParsedImport = {
	source: ImportSource;
	/** How the file was read: "1PUX", "JSON", "CSV", "XML" or "ZIP". */
	format: string;
	items: ItemFields[];
	left: Partial<Record<Leftover, number>>;
	/** Folders, vaults or collections, which come over as tags. */
	folders: string[];
	/** The files each item brings: from a ZIP, or a KeePass database or XML export. */
	files?: Map<ItemFields, ImportedFile[]>;
};

export class ImportError extends Error {}

/** What opening a protected file can take besides its password. */
export type OpenWith = {
	/** Argon2id with lanes: the key worker in the app, given directly in tests. */
	argon2?: import("./protected").Argon2Lanes;
	/** A KeePass database's key file, if it has one. */
	keyFile?: ArrayBuffer;
	/** Ends the opening: a KeePass database can take minutes to derive its key. */
	signal?: AbortSignal;
	/** The largest file this vauly takes: a database's bigger attachments aren't sent. */
	fileLimit?: number;
};

/**
 * A file that its app protected with a password: thrown where the format is found, with
 * what opens it. The import dialog asks for the password and calls `open`, which throws
 * WrongPasswordError (./protected.ts) for a wrong one, so it can ask again. A KeePass
 * database also takes a key file, and opens in a worker that can be cancelled.
 */
export class LockedExport extends Error {
	constructor(
		readonly app: "Bitwarden" | "Proton Pass" | "KeePass" | "vauly",
		readonly open: (password: string, more?: OpenWith) => Promise<ParsedImport>,
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
					files.map((file) => ({ ...file })),
				);
			}
			if (path && !folders.has(path)) {
				folders.add(path);
				result.folders.push(path);
			}
		},
	};
}
