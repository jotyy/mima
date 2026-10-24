// vauly://<item id>[/<field>] in environment values and .env files. A custom field is
// vauly://<item id>/fields/<its label>, the label URL-encoded: …/fields/Security%20answer.
// A file on the item is vauly://<item id>/files/<its name>; the command gets its path.

export type Field = "secret" | "username" | "url" | "notes" | "custom" | "file";

export type Reference = {
	name: string;
	itemId: string;
	field: Field;
	/** The custom field's label, for `field: "custom"`, or the file's name, for "file". */
	label?: string;
};

const pattern =
	/^vauly:\/\/(itm_[a-z0-9]+)(?:\/(password|secret|value|username|url|notes)|\/(fields|files)\/([^/]+))?$/;

export function parseReference(value: string): Omit<Reference, "name"> | null {
	const match = pattern.exec(value.trim());
	if (!match?.[1]) return null;
	if (match[4]) {
		try {
			const label = decodeURIComponent(match[4]);
			const field = match[3] === "files" ? "file" : "custom";
			return label.trim() ? { itemId: match[1], field, label } : null;
		} catch {
			return null;
		}
	}
	const field = match[2];
	return {
		itemId: match[1],
		field:
			!field || field === "password" || field === "value" || field === "secret"
				? "secret"
				: (field as Field),
	};
}

/** The reference as someone would write it: vauly://itm_…, …/username, …/fields/PIN. */
export function formatReference(ref: Omit<Reference, "name">) {
	const base = `vauly://${ref.itemId}`;
	if (ref.field === "secret") return base;
	if (ref.field === "custom" || ref.field === "file") {
		const kind = ref.field === "file" ? "files" : "fields";
		return `${base}/${kind}/${encodeURIComponent(ref.label ?? "")}`;
	}
	return `${base}/${ref.field}`;
}

export function findReferences(
	env: Record<string, string | undefined>,
): Reference[] {
	const found: Reference[] = [];
	for (const [name, value] of Object.entries(env)) {
		if (!value) continue;
		const ref = parseReference(value);
		if (ref) found.push({ name, ...ref });
	}
	return found;
}

/** Minimal .env parser: KEY=value, optional quotes, # comments. */
export function parseEnvFile(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
			line,
		);
		if (!match?.[1]) continue;
		let value = match[2] ?? "";
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		} else {
			value = value.replace(/\s+#.*$/, "");
		}
		out[match[1]] = value;
	}
	return out;
}

/** Replaces secret values in output, carrying a tail so values split across chunks still match. */
export function createMasker(secrets: string[]) {
	const values = [...new Set(secrets.filter((s) => s.length >= 4))].sort(
		(a, b) => b.length - a.length,
	);
	const keep = Math.max(0, ...values.map((v) => v.length)) - 1;
	let carry = "";
	const mask = (text: string) =>
		values.reduce((out, value) => out.split(value).join("<hidden>"), text);
	return {
		push(chunk: string) {
			const text = mask(carry + chunk);
			if (keep <= 0) {
				carry = "";
				return text;
			}
			carry = text.slice(-keep);
			return text.slice(0, -keep);
		},
		flush() {
			const rest = mask(carry);
			carry = "";
			return rest;
		},
	};
}
