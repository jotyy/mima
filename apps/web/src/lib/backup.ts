import type { ItemFields } from "./vault-data";

// A decrypted backup in Bitwarden's CSV layout, so most password managers can read it,
// plus the item kind and tags, so a vauly import brings back exactly what was there.

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
] as const;

export type BackupRow = ItemFields & { vault: string; favorite?: boolean };

export function toBackupCsv(rows: BackupRow[]) {
	const lines = rows.map((row) => {
		const values: Record<(typeof columns)[number], string> = {
			folder: row.vault,
			favorite: row.favorite ? "1" : "",
			type: row.kind === "note" ? "note" : "login",
			name: row.name,
			notes: row.notes ?? "",
			fields: "",
			reprompt: "0",
			login_uri: row.url ?? "",
			login_username: row.username ?? "",
			login_password: row.secret ?? "",
			login_totp: row.totp ?? "",
			vauly_kind: row.kind,
			vauly_tags: (row.tags ?? []).join(";"),
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
