import type { ItemFields } from "./vault-data";

// Reads the CSV exports of other password managers and browsers into item fields.
// Everything here runs on this device: the file is never uploaded as it is.

export type ImportSource =
	| "1Password"
	| "Bitwarden"
	| "LastPass"
	| "Chrome"
	| "Firefox"
	| "Safari"
	| "CSV";

export type ParsedImport = {
	source: ImportSource;
	items: ItemFields[];
	/** Rows with nothing worth keeping, or kinds mima doesn't store (cards, identities). */
	skipped: number;
};

export class ImportError extends Error {}

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const input = text.replace(/^﻿/, "");

	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (quoted) {
			if (char === '"' && input[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === '"' && cell === "") {
			quoted = true;
		} else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\n" || char === "\r") {
			if (char === "\r" && input[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else {
			cell += char;
		}
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows.filter((r) => r.some((value) => value.trim() !== ""));
}

type Columns = Record<string, number>;
type Row = (name: string) => string;

function detect(columns: Columns): ImportSource {
	const has = (...names: string[]) => names.every((name) => name in columns);
	if (has("login_password") || has("login_uri")) return "Bitwarden";
	if (has("grouping") || has("extra")) return "LastPass";
	if (has("formactionorigin") || has("httprealm")) return "Firefox";
	if (has("title", "archived")) return "1Password";
	if (has("title", "otpauth")) return "Safari";
	if (has("name", "url", "username", "password")) return "Chrome";
	return "CSV";
}

/** The first column that exists, for the generic fallback. */
const synonyms = {
	name: ["name", "title", "item", "account"],
	url: ["url", "uri", "website", "login_uri", "web site", "site"],
	username: ["username", "login_username", "user", "login", "email"],
	password: ["password", "login_password", "pass"],
	totp: ["totp", "otpauth", "login_totp", "otp", "one-time password"],
	notes: ["notes", "note", "extra", "comments", "comment"],
	tags: ["tags", "folder", "grouping", "group", "category"],
};

export function parseImport(text: string): ParsedImport {
	const [header, ...rows] = parseCsv(text);
	if (!header || rows.length === 0) {
		throw new ImportError("That file has no rows to import.");
	}
	const columns: Columns = {};
	header.forEach((name, index) => {
		const key = name.trim().toLowerCase();
		if (!(key in columns)) columns[key] = index;
	});
	const pick = (field: keyof typeof synonyms) =>
		synonyms[field].find((name) => name in columns);
	if (!pick("password") && !pick("notes")) {
		throw new ImportError(
			"That doesn't look like a password export: there's no password column.",
		);
	}

	const source = detect(columns);
	const items: ItemFields[] = [];
	let skipped = 0;

	for (const values of rows) {
		const get: Row = (name) => {
			const index = columns[name];
			return index === undefined ? "" : (values[index] ?? "").trim();
		};
		const field = (key: keyof typeof synonyms) => {
			const name = pick(key);
			return name ? get(name) : "";
		};

		// Bitwarden marks cards and identities; LastPass marks notes with this URL.
		const type = get("type").toLowerCase();
		if (source === "Bitwarden" && type && type !== "login" && type !== "note") {
			skipped++;
			continue;
		}
		const isNote =
			(source === "Bitwarden" && type === "note") ||
			(source === "LastPass" && field("url") === "http://sn");

		const item = toItem({
			name: field("name"),
			url: isNote ? "" : field("url"),
			username: field("username"),
			password: field("password"),
			totp: field("totp"),
			notes: field("notes"),
			tags: field("tags"),
			isNote,
		});
		if (item) items.push(item);
		else skipped++;
	}

	return { source, items, skipped };
}

function toItem(row: {
	name: string;
	url: string;
	username: string;
	password: string;
	totp: string;
	notes: string;
	tags: string;
	isNote: boolean;
}): ItemFields | null {
	const url = normalizeUrl(row.url);
	const tags = row.tags
		.split(/[;,/]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
	const optional = {
		...(row.notes && { notes: row.notes }),
		...(tags.length > 0 && { tags }),
	};

	if (row.isNote || (!row.password && !row.username && !url)) {
		if (!row.notes) return null;
		return {
			kind: "note",
			name: row.name || firstLine(row.notes),
			...optional,
		};
	}
	if (!row.password && !row.username) return null;
	return {
		kind: "login",
		name: row.name || hostOf(url) || row.username,
		...(row.username && { username: row.username }),
		...(row.password && { secret: row.password }),
		...(url && { url }),
		...(row.totp && { totp: row.totp }),
		...optional,
	};
}

function normalizeUrl(value: string) {
	const url = value.split(/\s*,\s*/)[0] ?? "";
	if (!url) return "";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
	if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(url)) return `https://${url}`;
	return url;
}

function hostOf(url: string) {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function firstLine(text: string) {
	const line = text.split("\n")[0]?.trim() ?? "";
	return line.length > 40 ? `${line.slice(0, 40)}…` : line || "Imported note";
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
