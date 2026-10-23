import type { ItemFields, ItemKind, PreviousSecret } from "../vault-data";

// What every format reads an item into before it becomes vauly's item fields. vauly keeps
// one address, one secret and one one-time code per item, so whatever else an item has
// (more addresses, custom fields) is written into its notes rather than lost.

export type Field = { label: string; value: string };

export type Draft = {
	/** Logins by default; an item with nothing but notes becomes a secure note. */
	kind?: ItemKind;
	name?: string;
	username?: string;
	secret?: string;
	urls?: string[];
	totp?: string;
	notes?: string;
	tags?: string[];
	/** A folder, vault or collection, as a path; it becomes a tag. */
	folder?: string;
	fields?: Field[];
	history?: PreviousSecret[];
};

const HISTORY_LIMIT = 10;

export function toItem(draft: Draft): ItemFields | null {
	const [first = "", ...others] = [
		...new Set((draft.urls ?? []).map(normalizeUrl).filter(Boolean)),
	];
	const username = draft.username?.trim() ?? "";
	const secret = draft.secret ?? "";
	const fields = [
		...(others.length > 0
			? [
					{
						label: others.length === 1 ? "Other website" : "Other websites",
						value: others.join("\n"),
					},
				]
			: []),
		...(draft.fields ?? []),
	].filter((field) => field.value.trim() !== "");
	const notes = joinNotes(draft.notes ?? "", fields);
	const tags = [
		...new Set((draft.tags ?? []).map((tag) => tag.trim()).filter(Boolean)),
	];
	const optional = {
		...(notes && { notes }),
		...(tags.length > 0 && { tags }),
	};

	const kind = draft.kind ?? "login";
	if (kind === "note" || (!secret.trim() && !username && !first)) {
		if (!notes) return null;
		return {
			kind: "note",
			name: draft.name?.trim() || firstLine(notes),
			...optional,
		};
	}
	if (kind === "login" && !secret && !username) return null;
	if (kind !== "login" && !secret) return null;
	const history = (draft.history ?? [])
		.filter((entry) => entry.secret && entry.secret !== secret)
		.slice(0, HISTORY_LIMIT);
	return {
		kind,
		name: draft.name?.trim() || hostOf(first) || username || "Imported item",
		...(username && { username }),
		...(secret && { secret }),
		...(first && { url: first }),
		...(draft.totp?.trim() && { totp: draft.totp.trim() }),
		...optional,
		...(history.length > 0 && { history }),
	};
}

function joinNotes(notes: string, fields: Field[]) {
	const lines = fields.map(({ label, value }) =>
		value.includes("\n")
			? `${label}:\n${value.trim()}`
			: `${label}: ${value.trim()}`,
	);
	return [notes.trim(), lines.join("\n")]
		.filter(Boolean)
		.join("\n\n")
		.replace(/\r\n?/g, "\n");
}

export function normalizeUrl(value: string) {
	const url = value.trim();
	if (!url) return "";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
	if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(url)) return `https://${url}`;
	return url;
}

export function hostOf(url: string) {
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

/** Splits "Work/Clients, billing" into tags. */
export function splitTags(value: string | undefined, separators = /[;,]/) {
	return (value ?? "")
		.split(separators)
		.map((tag) => tag.trim())
		.filter(Boolean);
}

/** A date from seconds, milliseconds or text, as an ISO string, or now when there's none. */
export function isoDate(value: unknown) {
	const date =
		typeof value === "number"
			? new Date(value < 1e12 ? value * 1000 : value)
			: typeof value === "string" && value
				? new Date(/^\d+$/.test(value) ? Number(value) * 1000 : value)
				: new Date();
	return Number.isNaN(date.getTime())
		? new Date().toISOString()
		: date.toISOString();
}
