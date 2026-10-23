import type { ItemKind, PreviousSecret } from "../vault-data";
import { keeperLabel } from "./csv";
import { type Draft, type Field, isoDate } from "./item";
import {
	collect,
	ImportError,
	type Leftover,
	type ParsedImport,
} from "./parsed";

// JSON exports: Bitwarden, 1Password's .1pux (its export.data), Proton Pass, Enpass and
// Keeper. None of them has a published schema that holds still, so every value is read
// defensively: a missing or odd field becomes an empty one, never an error.

type Json = Record<string, unknown>;

const obj = (value: unknown): Json =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Json)
		: {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const objs = (value: unknown) => list(value).map(obj);
const text = (value: unknown) =>
	typeof value === "string"
		? value
		: typeof value === "number" || typeof value === "boolean"
			? String(value)
			: "";

export function parseJsonExport(data: unknown): ParsedImport {
	const root = obj(data);
	if (root.encrypted === true) {
		throw new ImportError(
			"That Bitwarden export is encrypted. Export it again and choose the .json format, not .json (Encrypted).",
		);
	}
	if (Array.isArray(root.accounts)) return parseOnePassword(root);
	if (Object.keys(obj(root.vaults)).length > 0) return parseProtonPass(root);
	if (Array.isArray(root.records)) return parseKeeper(root);
	const items = objs(root.items);
	if (items.some((item) => "template_type" in item || "category" in item)) {
		return parseEnpass(root);
	}
	if (Array.isArray(root.items)) return parseBitwarden(root);
	if ("AUTHENTIFIANT" in root) {
		throw new ImportError(
			"That's an export from an old Dashlane app. Export your data to CSV from Dashlane instead.",
		);
	}
	throw new ImportError("That JSON file isn't an export vauly knows.");
}

// Bitwarden: https://bitwarden.com/help/condition-bitwarden-import/

function parseBitwarden(root: Json) {
	const into = collect("Bitwarden", "JSON");
	const names = new Map(
		[...objs(root.folders), ...objs(root.collections)].map((f) => [
			text(f.id),
			text(f.name),
		]),
	);
	for (const item of objs(root.items)) {
		const login = obj(item.login);
		into.leave("passkey", list(login.fido2Credentials).length);
		const type = item.type;
		if (type === 3) {
			into.leave("card");
			continue;
		}
		if (type === 4) {
			into.leave("identity");
			continue;
		}
		if (type !== 1 && type !== 2 && type !== 5) {
			into.leave("record");
			continue;
		}
		const ssh = obj(item.sshKey);
		const [folder, ...collections] = [
			text(item.folderId),
			...list(item.collectionIds).map(text),
		]
			.map((id) => names.get(id) ?? "")
			.filter(Boolean);
		into.add({
			kind: type === 2 ? "note" : type === 5 ? "ssh-key" : "login",
			name: text(item.name),
			username: text(login.username),
			secret: type === 5 ? text(ssh.privateKey) : text(login.password),
			urls: objs(login.uris).map((uri) => text(uri.uri)),
			totp: text(login.totp),
			notes: text(item.notes),
			folder,
			tags: [...collections, ...(item.archivedDate ? ["Archived"] : [])],
			fields: [
				...(type === 5
					? [
							{ label: "Public key", value: text(ssh.publicKey) },
							{ label: "Fingerprint", value: text(ssh.keyFingerprint) },
						]
					: []),
				...objs(item.fields)
					// Linked fields only point at the username or password.
					.filter((field) => field.type !== 3)
					.map((field) => ({
						label: text(field.name) || "Field",
						value: text(field.value),
					})),
			],
			history: newestFirst(
				objs(item.passwordHistory).map((entry) => ({
					secret: text(entry.password),
					until: isoDate(entry.lastUsedDate),
				})),
			),
		});
	}
	return into.result;
}

// 1Password: https://support.1password.com/1pux-format/

const onePasswordLeftovers: Record<string, Leftover | "skip"> = {
	"002": "card",
	"004": "identity",
	// A Document is a file, counted with the other attachments.
	"006": "skip",
	"101": "record",
	"103": "record",
	"104": "record",
	"105": "record",
	"106": "record",
	"107": "record",
	"108": "record",
	"113": "record",
};

/** Where each kind of 1Password item keeps its username, secret and address. */
const onePasswordRoles: Record<string, string[]> = {
	username: ["username", "pop_username"],
	secret: ["credential", "password", "wireless_password", "pop_password"],
	url: ["hostname", "url", "server", "pop_server"],
};

function parseOnePassword(root: Json) {
	const into = collect("1Password", "1PUX");
	const vaults = objs(root.accounts).flatMap((account) => objs(account.vaults));
	for (const vault of vaults) {
		const vaultName = text(obj(vault.attrs).name);
		for (const item of objs(vault.items)) {
			if (item.state === "trashed") {
				into.leave("trashed");
				continue;
			}
			const category = text(item.categoryUuid);
			const leftover = onePasswordLeftovers[category];
			if (leftover) {
				into.leave(leftover);
				continue;
			}
			const overview = obj(item.overview);
			const details = obj(item.details);
			const draft: Draft & { fields: Field[] } = {
				kind:
					category === "003" || category === "100"
						? "note"
						: category === "112"
							? "api-key"
							: category === "114"
								? "ssh-key"
								: "login",
				name: text(overview.title),
				secret: text(details.password),
				urls: [
					text(overview.url),
					...objs(overview.urls).map((url) => text(url.url)),
				],
				notes: text(details.notesPlain),
				tags: [
					...list(overview.tags).map(text),
					...(item.state === "archived" ? ["Archived"] : []),
				],
				folder: vaults.length > 1 ? vaultName : undefined,
				fields: [],
				history: newestFirst(
					objs(details.passwordHistory).map((entry) => ({
						secret: text(entry.value),
						until: isoDate(entry.time),
					})),
				),
			};
			for (const field of objs(details.loginFields)) {
				if (field.designation === "username" && !draft.username) {
					draft.username = text(field.value);
				} else if (field.designation === "password" && !draft.secret) {
					draft.secret = text(field.value);
				}
			}
			for (const section of objs(details.sections)) {
				for (const field of objs(section.fields)) {
					readOnePasswordField(draft, category, text(section.title), field);
				}
			}
			into.add(draft);
		}
	}
	return into.result;
}

function readOnePasswordField(
	draft: Draft & { fields: Field[] },
	category: string,
	section: string,
	field: Json,
) {
	const [kind = "", raw] = Object.entries(obj(field.value))[0] ?? [];
	const id = text(field.id);
	const title = text(field.title) || id;
	const label = section ? `${section} · ${title}` : title;
	if (kind === "file" || kind === "reference") return;
	if (kind === "totp") {
		if (!draft.totp) draft.totp = text(raw);
		else draft.fields.push({ label, value: text(raw) });
		return;
	}
	if (kind === "sshKey") {
		const key = obj(raw);
		const metadata = obj(key.metadata);
		draft.secret = text(metadata.privateKey) || text(key.privateKey);
		draft.fields.push(
			{ label: "Public key", value: text(metadata.publicKey) },
			{ label: "Fingerprint", value: text(metadata.fingerprint) },
		);
		return;
	}
	const value = onePasswordValue(kind, raw);
	// Items other than logins keep their username, secret and address in sections.
	if (category !== "001" && !section) {
		if (onePasswordRoles.username?.includes(id) && !draft.username) {
			draft.username = value;
			return;
		}
		if (onePasswordRoles.secret?.includes(id) && !draft.secret) {
			draft.secret = value;
			return;
		}
		if (onePasswordRoles.url?.includes(id) && !draft.urls?.some(Boolean)) {
			draft.urls = [value];
			return;
		}
	}
	draft.fields.push({ label, value });
}

function onePasswordValue(kind: string, value: unknown) {
	if (kind === "date" && typeof value === "number") {
		return isoDate(value).slice(0, 10);
	}
	if (kind === "monthYear" && typeof value === "number") {
		const month = String(value % 100).padStart(2, "0");
		return `${Math.floor(value / 100)}-${month}`;
	}
	if (kind === "email") return text(obj(value).email_address) || text(value);
	return show(value);
}

// Proton Pass: the data.json in its ZIP export.

function parseProtonPass(root: Json) {
	const into = collect("Proton Pass", "JSON");
	const vaults = Object.values(obj(root.vaults)).map(obj);
	for (const vault of vaults) {
		const folders = new Map(
			objs(vault.folders).map((folder) => [text(folder.folderId), folder]),
		);
		const folderPath = (id: string): string[] => {
			const folder = folders.get(id);
			if (!folder) return [];
			const parent = text(folder.parentFolderId);
			return [
				...(parent && parent !== id ? folderPath(parent) : []),
				text(folder.name),
			];
		};
		for (const item of objs(vault.items)) {
			if (item.state === 2) {
				into.leave("trashed");
				continue;
			}
			const data = obj(item.data);
			const content = obj(data.content);
			const metadata = obj(data.metadata);
			into.leave("passkey", list(content.passkeys).length);
			const type = text(data.type);
			if (type === "creditCard") {
				into.leave("card");
				continue;
			}
			if (type === "identity") {
				into.leave("identity");
				continue;
			}
			if (type === "alias") {
				into.leave("alias");
				continue;
			}
			const fields: Field[] = [];
			let totp = text(content.totpUri);
			const extra = [
				...objs(data.extraFields).map((field) => ({ field, section: "" })),
				...objs(content.sections).flatMap((section) =>
					objs(section.sectionFields).map((field) => ({
						field,
						section: text(section.sectionName),
					})),
				),
			];
			for (const { field, section } of extra) {
				const name = text(field.fieldName);
				const label = section ? `${section} · ${name}` : name;
				const value = obj(field.data);
				if (field.type === "totp") {
					if (!totp) totp = text(value.totpUri);
					else fields.push({ label, value: text(value.totpUri) });
				} else if (field.type === "timestamp") {
					fields.push({ label, value: protonDate(value.timestamp) });
				} else {
					fields.push({ label, value: text(value.content) });
				}
			}
			const path = [
				...(vaults.length > 1 ? [text(vault.name)] : []),
				...folderPath(text(item.folderId)),
			].filter(Boolean);
			const draft: Draft = {
				name: text(metadata.name),
				notes: text(metadata.note),
				totp,
				folder: path.join("/"),
				fields,
			};
			if (type === "login") {
				const username = text(content.itemUsername) || text(content.username);
				const email = text(content.itemEmail);
				const autofill = objs(content.autofillUrls).map((url) => text(url.url));
				into.add({
					...draft,
					username: username || email,
					secret: text(content.password),
					urls: autofill.length > 0 ? autofill : list(content.urls).map(text),
					fields: [
						...(username && email ? [{ label: "Email", value: email }] : []),
						...fields,
					],
				});
			} else if (type === "sshKey") {
				into.add({
					...draft,
					kind: "ssh-key",
					secret: text(content.privateKey),
					fields: [
						{ label: "Public key", value: text(content.publicKey) },
						...fields,
					],
				});
			} else if (type === "wifi") {
				into.add({
					...draft,
					secret: text(content.password),
					fields: [
						{ label: "Network name", value: text(content.ssid) },
						...fields,
					],
				});
			} else if (type === "custom") {
				// Custom items hold API keys, servers and the like; a hidden field that names a
				// key or token is the secret.
				const index = extra.findIndex(
					({ field }) =>
						field.type === "hidden" &&
						/api|key|token|secret|credential/i.test(text(field.fieldName)),
				);
				const secret = fields[index];
				into.add(
					secret
						? {
								...draft,
								kind: "api-key",
								secret: secret.value,
								fields: fields.filter((_, i) => i !== index),
							}
						: { ...draft, kind: "note" },
				);
			} else {
				into.add({ ...draft, kind: "note" });
			}
		}
	}
	return into.result;
}

function protonDate(value: unknown) {
	const seconds = obj(value).seconds ?? value;
	return isoDate(typeof seconds === "string" ? Number(seconds) : seconds).slice(
		0,
		10,
	);
}

// Enpass: File › Export › .json, which has no published schema.

function parseEnpass(root: Json) {
	const into = collect("Enpass", "JSON");
	const folders = new Map(
		objs(root.folders).map((folder) => [text(folder.uuid), folder]),
	);
	const folderPath = (id: string, depth = 0): string => {
		const folder = folders.get(id);
		if (!folder) return "";
		const parent =
			depth < 10 ? folderPath(text(folder.parent_uuid), depth + 1) : "";
		return parent ? `${parent}/${text(folder.title)}` : text(folder.title);
	};
	for (const item of objs(root.items)) {
		if (item.trashed === 1 || item.trashed === true) {
			into.leave("trashed");
			continue;
		}
		into.leave("attachment", list(item.attachments).length);
		const category = text(item.category);
		if (category === "creditcard") {
			into.leave("card");
			continue;
		}
		if (category === "identity") {
			into.leave("identity");
			continue;
		}
		if (category === "finance" || category === "travel") {
			into.leave("record");
			continue;
		}
		const draft: Draft & { fields: Field[]; urls: string[] } = {
			name: text(item.title),
			notes: text(item.note),
			urls: [],
			fields: [],
		};
		for (const field of objs(item.fields)) {
			const type = text(field.type);
			const value = text(field.value);
			if (field.deleted === 1 || type === "section" || !value.trim()) continue;
			if ((type === "username" || type === "email") && !draft.username) {
				draft.username = value;
			} else if (type === "password" && !draft.secret) {
				draft.secret = value;
			} else if (type === "url") {
				draft.urls.push(value);
			} else if (type === "totp" && !draft.totp) {
				draft.totp = value.startsWith("otpauth:")
					? value
					: value.replace(/\s/g, "").toUpperCase();
			} else {
				draft.fields.push({ label: text(field.label) || type, value });
			}
		}
		const [folder, ...tags] = list(item.folders)
			.map((id) => folderPath(text(id)))
			.filter(Boolean);
		const kind: ItemKind =
			category === "note" || category === "license"
				? "note"
				: !draft.secret && !draft.username
					? "note"
					: "login";
		into.add({
			...draft,
			kind,
			folder,
			tags: [
				...tags,
				...(item.archived === 1 || item.archived === true ? ["Archived"] : []),
			],
		});
	}
	return into.result;
}

// Keeper: https://docs.keeper.io/en/user-guides/import-records-1/import-json

const keeperLeftovers: Record<string, Leftover> = {
	bankCard: "card",
	address: "identity",
	contact: "identity",
	bankAccount: "record",
	birthCertificate: "record",
	driverLicense: "record",
	passport: "record",
	ssnCard: "record",
	membership: "record",
	healthInsurance: "record",
	file: "attachment",
	photo: "attachment",
};

function parseKeeper(root: Json) {
	const into = collect("Keeper", "JSON");
	for (const record of objs(root.records)) {
		const type = text(record.$type);
		const leftover = keeperLeftovers[type];
		if (leftover) {
			into.leave(leftover);
			continue;
		}
		const draft: Draft & { fields: Field[]; urls: string[] } = {
			kind:
				type === "encryptedNotes" || type === "softwareLicense"
					? "note"
					: type === "sshKeys"
						? "ssh-key"
						: "login",
			name: text(record.title),
			username: text(record.login),
			secret: text(record.password),
			urls: [text(record.login_url)],
			notes: text(record.notes),
			fields: [],
		};
		for (const [key, value] of Object.entries(obj(record.custom_fields))) {
			const base = key.split(":")[0];
			const values = list(value).length > 0 ? list(value) : [value];
			if (base === "$oneTimeCode") {
				const [first, ...others] = values.map(text);
				if (!draft.totp) draft.totp = first;
				for (const other of others)
					draft.fields.push({ label: "One-time code", value: other });
			} else if (base === "$url") {
				draft.urls.push(...values.map(text));
			} else if (base === "$keyPair") {
				const pair = obj(values[0]);
				if (draft.kind === "ssh-key") {
					// The record's password is the key's passphrase.
					if (draft.secret)
						draft.fields.push({ label: "Passphrase", value: draft.secret });
					draft.secret = text(pair.privateKey);
				} else {
					draft.fields.push({
						label: "Private key",
						value: text(pair.privateKey),
					});
				}
				draft.fields.push({ label: "Public key", value: text(pair.publicKey) });
			} else if (base === "$host" && !draft.urls.some(Boolean)) {
				const host = obj(values[0]);
				const port = text(host.port);
				draft.urls = [`${text(host.hostName)}${port ? `:${port}` : ""}`];
			} else if (base !== "$fileRef") {
				draft.fields.push({
					label: keeperLabel(key),
					value: /date/i.test(key)
						? values
								.map((v) =>
									typeof v === "number" ? isoDate(v).slice(0, 10) : show(v),
								)
								.join("\n")
						: show(value),
				});
			}
		}
		if (draft.kind === "ssh-key" && !draft.secret) draft.kind = "note";
		const [folder, ...more] = objs(record.folders).map((place) =>
			[text(place.shared_folder), text(place.folder)]
				.filter(Boolean)
				.join("/")
				.replace(/\\/g, "/"),
		);
		into.add({ ...draft, folder, tags: more });
	}
	return into.result;
}

/** A value of any shape as text: lists one per line, objects as their values. */
function show(value: unknown): string {
	if (Array.isArray(value)) return value.map(show).filter(Boolean).join("\n");
	if (value && typeof value === "object") {
		return Object.values(value).map(show).filter(Boolean).join(", ");
	}
	return text(value);
}

function newestFirst(history: PreviousSecret[]) {
	return history
		.filter((entry) => entry.secret)
		.sort((a, b) => b.until.localeCompare(a.until));
}
