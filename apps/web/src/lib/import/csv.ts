import { type Card, normalizeExpiry } from "@vauly/ui/lib/cards";
import type { Identity } from "@vauly/ui/lib/identity";

import type { ItemKind } from "../vault-data";
import { type Draft, type Field, isKind, splitTags } from "./item";
import {
	collect,
	ImportError,
	type ImportSource,
	type Leftover,
	type ParsedImport,
} from "./parsed";

// CSV exports, told apart by their header row. Each format reads a row into a draft item,
// or into the reason vauly leaves it out.

/**
 * RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF and a BOM.
 * KeePass escapes with backslashes instead (\" and \\), which `backslash` reads.
 */
export function parseCsv(text: string, backslash = false): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	const input = text.replace(/^﻿/, "");

	for (let i = 0; i < input.length; i++) {
		const char = input[i];
		if (quoted) {
			if (backslash && char === "\\" && i + 1 < input.length) {
				cell += input[i + 1];
				i++;
			} else if (char === '"' && input[i + 1] === '"') {
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

type Row = {
	/** The value of the first of these columns that has one, as it is in the file. */
	get: (...names: string[]) => string;
	/** The cells from this column to the end of the row, past the header too. */
	from: (name: string) => string[];
};

type CsvFormat = {
	source: ImportSource;
	/** Whether a header row (lowercase, trimmed) is this format's. */
	matches: (has: (...names: string[]) => boolean) => boolean;
	read: (row: Row) => Draft | Leftover | "skip";
};

const formats: CsvFormat[] = [
	{
		// A vauly backup: Bitwarden's layout with the item kind and tags alongside.
		source: "vauly",
		matches: (has) => has("vauly_kind"),
		read: (row) => {
			const draft = bitwardenRow(row);
			if (typeof draft === "string") return draft;
			const kind = row.get("vauly_kind");
			const fields = jsonList<Field>(row.get("vauly_fields")).filter(
				(field) =>
					typeof field?.label === "string" && typeof field.value === "string",
			);
			const details = jsonObject(row.get("vauly_details"));
			const card = isObject(details.card) ? (details.card as Card) : undefined;
			const identity = isObject(details.identity)
				? (details.identity as Identity)
				: undefined;
			const withDetails = kind === "card" || kind === "identity";
			return {
				...draft,
				folder: undefined,
				kind: isKind(kind) ? kind : draft.kind,
				tags: splitTags(row.get("vauly_tags"), /;/),
				// The exact fields, hidden ones marked; older backups have only Bitwarden's.
				// Bitwarden's column also holds a card's or an identity's details as lines.
				...((fields.length > 0 || withDetails) && { fields }),
				...(card && { card }),
				...(identity && { identity }),
				files: jsonList<string>(row.get("vauly_files"))
					.filter(
						(path) => typeof path === "string" && path.startsWith("files/"),
					)
					.map((path) => ({ path, name: path.split("/").pop() || "file" })),
			};
		},
	},
	{
		source: "Bitwarden",
		matches: (has) => has("login_password") || has("login_uri"),
		read: bitwardenRow,
	},
	{
		source: "LastPass",
		matches: (has) => has("grouping", "extra"),
		read: lastPassRow,
	},
	{
		source: "Dashlane",
		matches: (has) => has("username2", "title", "category"),
		read: dashlaneRow,
	},
	{
		source: "Proton Pass",
		matches: (has) => has("type", "createtime", "modifytime"),
		read: (row) => {
			const type = row.get("type");
			if (type === "creditCard") return "card";
			if (type === "identity") return "identity";
			if (type === "alias") return "alias";
			const username = row.get("username");
			const email = row.get("email");
			return {
				kind: type === "note" ? "note" : "login",
				name: row.get("name"),
				username: username || email,
				secret: row.get("password"),
				urls: row.get("url").split(", "),
				totp: row.get("totp"),
				notes: row.get("note"),
				fields: username && email ? [{ label: "Email", value: email }] : [],
				folder: row.get("vault"),
			};
		},
	},
	{
		source: "NordPass",
		matches: (has) => has("cardholdername") || has("additional_urls"),
		read: (row) => {
			const type = row.get("type");
			if (type === "credit_card") return "card";
			if (type === "identity") return "identity";
			if (type === "folder") return "skip";
			return {
				kind: type === "note" ? "note" : "login",
				name: row.get("name"),
				username: row.get("username"),
				secret: row.get("password"),
				urls: [row.get("url"), ...jsonList<string>(row.get("additional_urls"))],
				totp: row.get("totp"),
				notes: row.get("note"),
				folder: row.get("folder"),
				fields: jsonList<{ label?: string; value?: string }>(
					row.get("custom_fields"),
				).map((field) => ({
					label: field.label ?? "Field",
					value: String(field.value ?? ""),
				})),
			};
		},
	},
	{
		source: "RoboForm",
		matches: (has) => has("pwd", "matchurl"),
		read: roboFormRow,
	},
	{
		source: "KeePassXC",
		matches: (has) => has("group", "title", "username", "password"),
		read: (row) => {
			// KeePassXC writes "Root/Work/Clients"; the root group is the database itself,
			// whatever it's called.
			const folder = row.get("group").split("/").slice(1).join("/");
			if (/^Recycle Bin(\/|$)/.test(folder)) return "trashed";
			return {
				name: row.get("title"),
				username: row.get("username"),
				secret: row.get("password"),
				urls: [row.get("url")],
				totp: row.get("totp"),
				notes: row.get("notes"),
				folder,
			};
		},
	},
	{
		source: "KeePass",
		matches: (has) => has("account", "login name", "password"),
		read: (row) => ({
			name: row.get("account"),
			username: row.get("login name"),
			secret: row.get("password"),
			urls: [row.get("web site")],
			notes: row.get("comments"),
		}),
	},
	{
		source: "Firefox",
		matches: (has) => has("formactionorigin") || has("httprealm"),
		read: (row) =>
			// Firefox keeps the key to its own sync among the logins.
			row.get("url").startsWith("chrome://")
				? "skip"
				: {
						username: row.get("username"),
						secret: row.get("password"),
						urls: [row.get("url")],
					},
	},
	{
		source: "1Password",
		matches: (has) => has("title", "archived"),
		read: (row) => ({
			name: row.get("title"),
			username: row.get("username"),
			secret: row.get("password"),
			urls: row.get("url", "website").split(/,\s*/),
			totp: row.get("otpauth", "one-time password"),
			notes: row.get("notes"),
			tags: [
				...splitTags(row.get("tags")),
				...(row.get("archived") === "true" ? ["Archived"] : []),
			],
		}),
	},
	{
		// Older Safari exports have no OTPAuth or Notes column.
		source: "Apple Passwords",
		matches: (has) =>
			has("title", "otpauth") || has("title", "url", "username", "password"),
		read: (row) => ({
			name: row.get("title"),
			username: row.get("username"),
			secret: row.get("password"),
			urls: [row.get("url")],
			totp: row.get("otpauth"),
			notes: row.get("notes"),
		}),
	},
	{
		// Chrome, Edge, Brave and the other Chromium browsers.
		source: "Chrome",
		matches: (has) => has("name", "url", "username", "password"),
		read: (row) => ({
			name: row.get("name"),
			username: row.get("username"),
			secret: row.get("password"),
			urls: [row.get("url")],
			notes: row.get("note"),
		}),
	},
];

/** Any other CSV: the first column that exists for each field. */
const generic: CsvFormat = {
	source: "CSV",
	matches: () => true,
	read: (row) => ({
		name: row.get("name", "title", "item", "account"),
		username: row.get("username", "user", "login", "email", "login name"),
		secret: row.get("password", "pass", "pwd"),
		urls: [row.get("url", "uri", "website", "web site", "site", "login url")],
		totp: row.get("totp", "otpauth", "otp", "one-time password"),
		notes: row.get("notes", "note", "comments", "comment", "extra"),
		folder: row.get("folder", "group", "grouping", "category"),
		tags: splitTags(row.get("tags")),
	}),
};

export function parseCsvExport(text: string): ParsedImport {
	const rows = parseCsv(
		text,
		/^\uFEFF?"Account","Login Name","Password"/.test(text),
	);
	const [header, ...body] = rows;
	if (!header || body.length === 0) {
		if (header && looksLikeKeeper(rows)) return readKeeper(rows);
		throw new ImportError("That file has no rows to import.");
	}
	const names = header.map((name) => name.trim().toLowerCase());
	const has = (...wanted: string[]) =>
		wanted.every((name) => names.includes(name));
	const format = formats.find((f) => f.matches(has)) ?? generic;
	if (
		format === generic &&
		!["password", "pass", "pwd", "notes", "note"].some((name) => has(name))
	) {
		if (looksLikeKeeper(rows)) return readKeeper(rows);
		throw new ImportError(
			"That doesn't look like a password export: there's no password column.",
		);
	}
	return readRows(format, names, body, "CSV");
}

function readRows(
	format: CsvFormat,
	names: string[],
	rows: string[][],
	type: string,
	into = collect(format.source, type),
) {
	for (const values of rows) {
		const row: Row = {
			get: (...wanted) => {
				for (const name of wanted) {
					const value = values[names.indexOf(name)] ?? "";
					if (names.includes(name) && value.trim() !== "") return value;
				}
				return "";
			},
			from: (name) => {
				const index = names.indexOf(name);
				return index < 0 ? [] : values.slice(index);
			},
		};
		const read = format.read(row);
		if (typeof read === "string") into.leave(read);
		else into.add(read);
	}
	return into.result;
}

/**
 * Dashlane's CSV export: a ZIP, or a folder on phones, with one CSV per kind of item.
 * The keys are file names in lowercase.
 */
export function parseDashlane(files: Record<string, string>): ParsedImport {
	const into = collect("Dashlane", "ZIP");
	const table = (name: string) => {
		const [header, ...rows] = parseCsv(files[name] ?? "");
		return {
			names: (header ?? []).map((n) => n.trim().toLowerCase()),
			rows,
		};
	};
	const credentials = table("credentials.csv");
	readRows(
		{ source: "Dashlane", matches: () => true, read: dashlaneRow },
		credentials.names,
		credentials.rows,
		"ZIP",
		into,
	);
	const notes = table("securenotes.csv");
	readRows(
		{
			source: "Dashlane",
			matches: () => true,
			read: (row) => ({
				kind: "note",
				name: row.get("title"),
				notes: row.get("note"),
			}),
		},
		notes.names,
		notes.rows,
		"ZIP",
		into,
	);
	for (const get of rowsOf(table("payments.csv"))) {
		if (get("type") !== "payment_card") {
			into.leave("record");
			continue;
		}
		into.add({
			kind: "card",
			name: get("account_name"),
			card: {
				cardholder: get("account_holder"),
				number: get("cc_number"),
				expiry: normalizeExpiry(
					get("expiration_month"),
					get("expiration_year"),
				),
				code: get("code"),
			},
			fields: [
				{ label: "Issuing bank", value: get("issuing_bank") },
				{ label: "Country", value: get("country") },
			],
		});
	}
	const identity = dashlaneIdentity(
		rowsOf(table("personalinfo.csv")),
		rowsOf(table("ids.csv")),
	);
	if (identity) into.add(identity);
	return into.result;
}

/** A table's rows, each as a lookup by column name. */
function rowsOf(table: { names: string[]; rows: string[][] }) {
	return table.rows.map(
		(values) => (name: string) =>
			(values[table.names.indexOf(name)] ?? "").trim(),
	);
}

/** Dashlane's ID documents, as the hidden fields they become on the identity. */
const dashlaneDocuments: Record<string, string> = {
	passport: "Passport number",
	id_card: "ID card number",
	driver_license: "Driving licence number",
	license: "Driving licence number",
	social_security: "Social security number",
	tax_number: "Tax number",
};

/**
 * Dashlane keeps a person's details a row each (a name, an email, a phone, an address)
 * and their ID documents apart, so they come together as one identity.
 */
function dashlaneIdentity(
	info: ((name: string) => string)[],
	ids: ((name: string) => string)[],
): Draft | null {
	if (info.length === 0 && ids.length === 0) return null;
	const identity: Identity = {};
	const fields: Field[] = [];
	for (const get of info) {
		const type = get("type");
		if (type === "name" && !identity.name) {
			identity.name = [
				get("title"),
				get("first_name"),
				get("middle_name"),
				get("last_name"),
			]
				.filter(Boolean)
				.join(" ");
		} else if (type === "email" && !identity.email) {
			identity.email = get("email");
		} else if (type === "phone" && !identity.phone) {
			identity.phone = get("phone_number");
		} else if (type === "address" && !identity.address) {
			identity.address = [
				get("address_recipient"),
				get("address"),
				get("address_building"),
				get("address_apartment"),
			]
				.filter(Boolean)
				.join("\n");
			identity.city = get("city");
			identity.region = get("state");
			identity.postalCode = get("zip");
			identity.country = get("country");
		} else if (type === "company" && !identity.company) {
			identity.company = get("item_name") || get("title");
		} else {
			const value =
				get("email") || get("phone_number") || get("url") || get("item_name");
			fields.push({ label: get("item_name") || type, value });
		}
	}
	for (const get of ids) {
		const type = get("type");
		const label = dashlaneDocuments[type] ?? `${type || "ID"} number`;
		if (
			(type === "social_security" || type === "tax_number") &&
			!identity.taxNumber
		) {
			identity.taxNumber = get("number");
		} else {
			fields.push({ label, value: get("number"), hidden: true });
		}
		if (!identity.name) identity.name = get("name");
	}
	return { kind: "identity", identity, fields };
}

function dashlaneRow(row: Row): Draft {
	const [username, ...others] = [
		...new Set(
			[row.get("username"), row.get("username2"), row.get("username3")].filter(
				Boolean,
			),
		),
	];
	return {
		name: row.get("title"),
		username,
		secret: row.get("password"),
		urls: [row.get("url")],
		totp: row.get("otpurl", "otpsecret"),
		notes: row.get("note"),
		folder: row.get("category"),
		fields: others.map((value) => ({ label: "Other username", value })),
	};
}

function bitwardenRow(row: Row): Draft | Leftover | "skip" {
	const type = row.get("type");
	if (type === "card") return "card";
	if (type === "identity") return "identity";
	return {
		kind: type === "note" ? "note" : "login",
		name: row.get("name"),
		username: row.get("login_username"),
		secret: row.get("login_password"),
		urls: row.get("login_uri").split(","),
		totp: row.get("login_totp"),
		notes: row.get("notes"),
		fields: nameValueLines(row.get("fields")),
		folder: row.get("folder", "collections"),
		tags: row.get("archiveddate") ? ["Archived"] : [],
	};
}

/** LastPass marks secure notes with this address and keeps their kind in the notes. */
function lastPassRow(row: Row): Draft | Leftover | "skip" {
	const url = row.get("url");
	const base = {
		name: row.get("name"),
		// Folders nest with backslashes, and can carry control characters.
		folder: row
			.get("grouping")
			// biome-ignore lint/suspicious/noControlCharactersInRegex: they're what's removed
			.replace(/[\x00-\x1f\x7f-\x9f]/g, "")
			.replace(/\\/g, "/"),
	};
	if (url !== "http://sn") {
		return {
			...base,
			username: row.get("username"),
			secret: row.get("password"),
			urls: [url === "http://" ? "" : url],
			totp: row.get("totp"),
			notes: row.get("extra"),
		};
	}
	const extra = row.get("extra");
	const type = /^NoteType:(.*)/.exec(extra)?.[1]?.trim();
	if (!type) return { ...base, kind: "note", notes: extra };
	const fields = lastPassFields(extra);
	const take = (...labels: string[]) => {
		const index = fields.findIndex((field) => labels.includes(field.label));
		return index < 0 ? "" : (fields.splice(index, 1)[0]?.value ?? "");
	};
	take("NoteType");
	take("Language");
	const notes = take("Notes");
	switch (type) {
		case "Credit Card":
			return "card";
		case "Address":
			return "identity";
		case "Bank Account":
		case "Passport":
		case "Driver's License":
		case "Social Security":
		case "Insurance":
		case "Health Insurance":
		case "Membership":
			return "record";
		case "SSH Key":
			return {
				...base,
				kind: "ssh-key",
				secret: take("Private Key"),
				notes,
				fields,
			};
		case "Wi-Fi Password":
			return { ...base, secret: take("Password"), notes, fields };
		case "Server":
		case "Database":
		case "Email Account":
		case "Instant Messenger":
			return {
				...base,
				username: take("Username"),
				secret: take("Password"),
				urls: [take("Hostname", "Server")],
				notes,
				fields,
			};
		default:
			return { ...base, kind: "note", notes, fields };
	}
}

/** "Key:Value" lines; a line that doesn't start a key continues the value before it. */
function lastPassFields(extra: string): Field[] {
	const fields: Field[] = [];
	let notes = false;
	for (const line of extra.split(/\r?\n/)) {
		const match: RegExpExecArray | null = notes
			? null
			: /^([A-Z][\w '’/-]{0,40}):(.*)$/.exec(line);
		const last = fields[fields.length - 1];
		if (match?.[1] !== undefined) {
			fields.push({ label: match[1], value: match[2] ?? "" });
			notes = match[1] === "Notes";
		} else if (last) {
			last.value += `\n${line}`;
		}
	}
	return fields;
}

/**
 * RoboForm adds an apostrophe before a login or password that starts with @ or ', and
 * keeps more fields in cells past the header, each "name,?,?,type,value".
 */
function roboFormRow(row: Row): Draft | Leftover | "skip" {
	const unquote = (value: string) => value.replace(/^'(?=@|')/, "");
	const username = unquote(row.get("login"));
	const secret = unquote(row.get("pwd"));
	const url = row.get("url");
	const matchUrl = row.get("matchurl");
	// A bookmark: an address and nothing to sign in with.
	if (url && !matchUrl && !username && !secret) return "skip";
	let totp = "";
	const fields: Field[] = [];
	for (const cell of row.from("rffieldsv2")) {
		const [name = "", , , , ...rest] = cell.split(",");
		const value = rest.join(",");
		if (!value.trim()) continue;
		if (name === "TOTP KEY$") totp = value;
		else if (name === "User ID$" && value === username) continue;
		else if (name === "Password$" && value === secret) continue;
		else
			fields.push({
				label: name === "-no-name-" ? "Field" : name.replace(/\$$/, ""),
				value,
			});
	}
	return {
		name: row.get("name"),
		username,
		secret,
		urls: [url, matchUrl],
		totp,
		notes: row.get("note"),
		folder: row.get("folder").replace(/\\/g, "/").replace(/^\//, ""),
		fields,
	};
}

/**
 * Keeper's CSV has no header: folder, title, login, password, website, notes, shared
 * folder, then name and value pairs. It's told apart by that shape alone.
 */
function looksLikeKeeper(rows: string[][]) {
	return rows.every((row) => row.length >= 7 && (row.length - 7) % 2 === 0);
}

function readKeeper(rows: string[][]) {
	const { result, add } = collect("Keeper", "CSV");
	const seen = new Set<string>();
	for (const row of rows) {
		// A record in several folders comes once per folder.
		const key = row.slice(1).join("\u0000");
		if (seen.has(key)) continue;
		seen.add(key);
		const [folder = "", name, username, secret, url, notes, shared = ""] = row;
		let totp = "";
		let kind: ItemKind = "login";
		const fields: Field[] = [];
		for (let i = 7; i + 1 < row.length; i += 2) {
			const label = row[i] ?? "";
			const value = row[i + 1] ?? "";
			if (label === "TFC:Keeper" || label === "$oneTimeCode") totp = value;
			else if (label === "$type")
				kind = value === "encryptedNotes" ? "note" : kind;
			else if (label !== "$record_uid" && value.trim())
				fields.push({ label: keeperLabel(label), value });
		}
		add({
			kind,
			name,
			username,
			secret,
			urls: [url ?? ""],
			totp,
			notes,
			fields,
			folder: (folder || shared.replace(/#(edit|reshare)/g, "")).replace(
				/\\/g,
				"/",
			),
		});
	}
	return result;
}

/** "$text:Account ID:1" → "Account ID"; "$pinCode::1" → "Pin code"; "PIN" stays. */
export function keeperLabel(key: string) {
	if (!key.startsWith("$")) return key || "Field";
	const [type = "", label] = key.slice(1).split(":");
	if (label) return label;
	const words = type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
	return words ? words[0]?.toUpperCase() + words.slice(1) : "Field";
}

/** Bitwarden's custom fields in CSV, one "Name: value" per line. */
function nameValueLines(text: string): Field[] {
	return text
		.split(/\r?\n/)
		.map((line) => /^([^:]+):\s?(.*)$/.exec(line))
		.flatMap((match) =>
			match?.[1] ? [{ label: match[1].trim(), value: match[2] ?? "" }] : [],
		);
}

function jsonList<T>(text: string): T[] {
	if (!text.trim().startsWith("[")) return [];
	try {
		const value: unknown = JSON.parse(text);
		return Array.isArray(value) ? value : [];
	} catch {
		return [];
	}
}

/** A JSON object from a column, or an empty one when it holds anything else. */
function jsonObject(value: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(value);
		return isObject(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === "object" && !Array.isArray(value);
