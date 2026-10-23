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

export type ParsedImport = {
	source: ImportSource;
	/** How the file was read: "1PUX", "JSON", "CSV", "XML" or "ZIP". */
	format: string;
	items: ItemFields[];
	left: Partial<Record<Leftover, number>>;
	/** Folders, vaults or collections, which come over as tags. */
	folders: string[];
};

export class ImportError extends Error {}

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
		add({ folder, ...draft }: Draft) {
			const path = folder?.trim();
			const item = toItem(
				path ? { ...draft, tags: [path, ...(draft.tags ?? [])] } : draft,
			);
			if (!item) return leave("empty");
			result.items.push(item);
			if (path && !folders.has(path)) {
				folders.add(path);
				result.folders.push(path);
			}
		},
	};
}
