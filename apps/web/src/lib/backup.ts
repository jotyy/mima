import { addressLines } from "@vauly/ui/lib/identity";

import { type ItemFields, websitesOf } from "./vault-data";

// A decrypted backup in Bitwarden's CSV layout, so most password managers can read it,
// plus the item kind, tags and custom fields, so a vauly import brings back exactly what
// was there. Bitwarden's own columns hold every website (comma-separated) and the custom
// fields as "label: value" lines; vauly_fields keeps them whole, hidden ones marked.
// A card or an identity is a note to other apps, its details among the fields;
// vauly_details keeps them as vauly has them.

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

export type BackupRow = ItemFields & { vault: string; favorite?: boolean };

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
		};
		return columns.map((column) => quote(values[column])).join(",");
	});
	return [columns.join(","), ...lines].join("\n");
}

function quote(value: string) {
	return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function backupFileName(date = new Date()) {
	return `vauly-backup-${date.toISOString().slice(0, 10)}.csv`;
}
