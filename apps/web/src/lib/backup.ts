import { addressLines } from "@vauly/ui/lib/identity";
import { strToU8, type Zippable, zipSync } from "fflate";

import type { SealedFile } from "./import/protected";
import { type ItemFields, websitesOf } from "./vault-data";

// A decrypted backup in Bitwarden's CSV layout, so most password managers can read it,
// plus the item kind, tags and custom fields, so a vauly import brings back exactly what
// was there. Bitwarden's own columns hold every website (comma-separated) and the custom
// fields as "label: value" lines; vauly_fields keeps them whole, hidden ones marked.
// A card or an identity is a note to other apps, its details among the fields;
// vauly_details keeps them as vauly has them. A backup with files is a ZIP of the CSV
// and a files/ folder, and vauly_files says which files are each item's.

const columns = [
	"folder",
	"favorite",
	"type",
	"name",
	"notes",
	"fields",
	"reprompt",
	"login_uri",
	"login_username",
	"login_password",
	"login_totp",
	"vauly_kind",
	"vauly_tags",
	"vauly_fields",
	"vauly_details",
	"vauly_files",
] as const;

/** A card's or an identity's details as labelled lines, the way other apps keep fields. */
function detailLines(row: ItemFields) {
	const { card, identity } = row;
	const lines: [string, string | undefined][] = card
		? [
				["Cardholder", card.cardholder],
				["Number", card.number],
				["Expires", card.expiry],
				["Security code", card.code],
				["PIN", card.pin],
			]
		: identity
			? [
					["Name", identity.name],
					["Company", identity.company],
					["Email", identity.email],
					["Phone", identity.phone],
					["Address", addressLines(identity).join(", ")],
					["Tax number", identity.taxNumber],
					["Registration number", identity.registrationNumber],
				]
			: [];
	return lines.flatMap(([label, value]) =>
		value ? [`${label}: ${value}`] : [],
	);
}

export type BackupRow = ItemFields & {
	vault: string;
	favorite?: boolean;
	/** Where the backup ZIP keeps the item's files. */
	files?: string[];
};

export function toBackupCsv(rows: BackupRow[]) {
	const lines = rows.map((row) => {
		const values: Record<(typeof columns)[number], string> = {
			folder: row.vault,
			favorite: row.favorite ? "1" : "",
			type:
				row.kind === "note" || row.kind === "card" || row.kind === "identity"
					? "note"
					: "login",
			name: row.name,
			notes: row.notes ?? "",
			fields: [
				...detailLines(row),
				...(row.fields ?? []).map((field) => `${field.label}: ${field.value}`),
			].join("\n"),
			reprompt: "0",
			login_uri: websitesOf(row).join(","),
			login_username: row.username ?? "",
			login_password: row.secret ?? "",
			login_totp: row.totp ?? "",
			vauly_kind: row.kind,
			vauly_tags: (row.tags ?? []).join(";"),
			vauly_fields: row.fields?.length ? JSON.stringify(row.fields) : "",
			vauly_details: row.card
				? JSON.stringify({ card: row.card })
				: row.identity
					? JSON.stringify({ identity: row.identity })
					: "",
			vauly_files: row.files?.length ? JSON.stringify(row.files) : "",
		};
		return columns.map((column) => quote(values[column])).join(",");
	});
	return [columns.join(","), ...lines].join("\n");
}

function quote(value: string) {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function backupFileName(date = new Date(), extension = "csv") {
	return `vauly-backup-${date.toISOString().slice(0, 10)}.${extension}`;
}

const reserved =
	/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)$/i;

/**
 * Where a file goes in the ZIP: a folder of its own, so two files can share a name, and a
 * name that's safe to unpack anywhere: no separators or characters Windows forbids, no
 * trailing dots or spaces, and no device name such as CON.
 */
export function backupFilePath(index: number, name: string) {
	const safe = Array.from(name, (char) =>
		char.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(char) ? "_" : char,
	)
		.join("")
		.replace(/[. ]+$/, "")
		.replace(/^\.+/, "_");
	const stem = safe.split(".")[0]?.trim() ?? "";
	return `files/${index}/${!safe ? "file" : reserved.test(stem) ? `_${safe}` : safe}`;
}

/** The CSV and the files, in a ZIP. Files are stored as they are: most don't shrink. */
export function toBackupZip(
	csvName: string,
	rows: BackupRow[],
	files: Map<string, Uint8Array>,
) {
	const entries: Zippable = { [csvName]: strToU8(toBackupCsv(rows)) };
	for (const [path, data] of files) entries[path] = [data, { level: 0 }];
	return zipSync(entries);
}

/**
 * A protected backup with files: the password-protected export, and each file sealed with
 * a key of its own (./import/protected.ts) at files/<n>. Only the export, encrypted, has
 * the files' names and keys.
 */
export function toSealedBackupZip(
	jsonName: string,
	json: string,
	sealed: Map<string, Uint8Array>,
) {
	const entries: Zippable = { [jsonName]: strToU8(json) };
	for (const [path, data] of sealed) entries[path] = [data, { level: 0 }];
	return zipSync(entries);
}

// --- A protected backup ---------------------------------------------------------------
// Bitwarden's JSON export, which a protected backup encrypts in Bitwarden's
// password-protected format (./import/protected.ts), so Bitwarden opens it as well as
// vauly. Each item also carries vauly's own copy of it under "vauly", which Bitwarden's
// import leaves alone and vauly's reads instead (./import/json.ts).

/** What a backup keeps of an item: everything but its passkey, sealed to its vault. */
function vaulyCopy({
	vault,
	favorite,
	passkey,
	...item
}: BackupRow): ItemFields {
	return item;
}

/** Bitwarden's month and year from vauly's "MM/YYYY". */
function expiryOf(expiry?: string) {
	const parts = /^(\d{1,2})\/(\d{2,4})$/.exec(expiry ?? "");
	return parts
		? { expMonth: String(Number(parts[1])), expYear: parts[2] ?? null }
		: { expMonth: null, expYear: null };
}

function bitwardenItem(row: BackupRow, id: string, folderId: string | null) {
	const field = (label: string, value?: string, hidden = false) =>
		value ? [{ name: label, value, type: hidden ? 1 : 0, linkedId: null }] : [];
	const fields = (row.fields ?? []).flatMap((custom) =>
		field(custom.label, custom.value, custom.hidden),
	);
	const fieldValue = (label: string) =>
		row.fields?.find((custom) => custom.label === label)?.value ?? "";
	const common = {
		id,
		organizationId: null,
		folderId,
		collectionIds: null,
		name: row.name,
		notes: row.notes || null,
		favorite: Boolean(row.favorite),
		reprompt: 0,
		fields,
		vauly: vaulyCopy(row),
	};
	switch (row.kind) {
		case "note":
			return { ...common, type: 2, secureNote: { type: 0 } };
		case "card": {
			const card = row.card ?? {};
			return {
				...common,
				type: 3,
				card: {
					cardholderName: card.cardholder || null,
					brand: null,
					number: card.number || null,
					...expiryOf(card.expiry),
					code: card.code || null,
				},
				fields: [...field("PIN", card.pin, true), ...fields],
			};
		}
		case "identity": {
			const person = row.identity ?? {};
			const names = (person.name ?? "").split(/\s+/).filter(Boolean);
			const street = (person.address ?? "").split("\n");
			return {
				...common,
				type: 4,
				identity: {
					title: null,
					firstName: names.slice(0, -1).join(" ") || names[0] || null,
					middleName: null,
					lastName: names.length > 1 ? (names.at(-1) ?? null) : null,
					address1: street[0] || null,
					address2: street[1] || null,
					address3: street.slice(2).join(", ") || null,
					city: person.city || null,
					state: person.region || null,
					postalCode: person.postalCode || null,
					country: person.country || null,
					company: person.company || null,
					email: person.email || null,
					phone: person.phone || null,
					ssn: person.taxNumber || null,
					username: null,
					passportNumber: null,
					licenseNumber: null,
				},
				fields: [
					...field("Registration number", person.registrationNumber),
					...fields,
				],
			};
		}
		case "ssh-key":
			return {
				...common,
				type: 5,
				sshKey: {
					privateKey: row.secret ?? "",
					publicKey: fieldValue("Public key"),
					keyFingerprint: fieldValue("Fingerprint"),
				},
			};
		default:
			// A login, or an API key as a login with its value for the password.
			return {
				...common,
				type: 1,
				login: {
					uris: websitesOf(row).map((uri) => ({ match: null, uri })),
					username: row.username || null,
					password: row.secret || null,
					totp: row.totp || null,
				},
				passwordHistory: (row.history ?? []).map((earlier) => ({
					lastUsedDate: earlier.until,
					password: earlier.secret,
				})),
			};
	}
}

/**
 * The items as Bitwarden's JSON export: vaults become folders. A protected backup's
 * files go beside it, sealed, and `files` says what each one at files/<n> is: its key,
 * size and SHA-256 (./import/protected.ts).
 */
export function toBackupJson(
	rows: BackupRow[],
	files?: Record<string, SealedFile>,
) {
	const vaults = [...new Set(rows.map((row) => row.vault).filter(Boolean))];
	const folderOf = new Map(
		vaults.map((name, index) => [name, `vault-${index + 1}`]),
	);
	return JSON.stringify(
		{
			encrypted: false,
			// A vauly backup: vauly's import reads each item's own copy.
			vauly: 1,
			...(files && Object.keys(files).length > 0 && { vaulyFiles: files }),
			folders: vaults.map((name) => ({ id: folderOf.get(name), name })),
			items: rows.map((row, index) =>
				bitwardenItem(
					row,
					`item-${index + 1}`,
					folderOf.get(row.vault) ?? null,
				),
			),
		},
		null,
		2,
	);
}
