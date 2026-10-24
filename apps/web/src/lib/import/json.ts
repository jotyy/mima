import { type Card, normalizeExpiry } from "@vauly/ui/lib/cards";
import type { Identity } from "@vauly/ui/lib/identity";

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

/** Words given apart, such as a name's parts, as one: "Alex J Example". */
const joined = (...parts: unknown[]) =>
	parts
		.map((part) => text(part).trim())
		.filter(Boolean)
		.join(" ");
/** Lines given apart, such as an address's, as one value of several lines. */
const lines = (...parts: unknown[]) =>
	parts
		.map((part) => text(part).trim())
		.filter(Boolean)
		.join("\n");

export function parseJsonExport(data: unknown): ParsedImport {
	const root = obj(data);
	// A password-protected one is opened before it gets here (./index.ts); this one is
	// sealed with the Bitwarden account's own key.
	if (root.encrypted === true) {
		throw new ImportError(
			"That Bitwarden export is account restricted: only your Bitwarden account can open it. Export again with .json (Encrypted) and choose Password protected.",
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
		if (type !== 1 && type !== 2 && type !== 3 && type !== 4 && type !== 5) {
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
		const custom = objs(item.fields)
			// Linked fields only point at the username or password.
			.filter((field) => field.type !== 3)
			.map((field) => ({
				label: text(field.name) || "Field",
				value: text(field.value),
				// Type 1 is Bitwarden's hidden field.
				hidden: field.type === 1,
			}));
		const common = {
			name: text(item.name),
			notes: text(item.notes),
			folder,
			tags: [...collections, ...(item.archivedDate ? ["Archived"] : [])],
		};
		if (type === 3) {
			const card = obj(item.card);
			into.add({
				...common,
				kind: "card",
				card: {
					cardholder: text(card.cardholderName),
					number: text(card.number),
					expiry: normalizeExpiry(text(card.expMonth), text(card.expYear)),
					code: text(card.code),
				},
				fields: custom,
			});
			continue;
		}
		if (type === 4) {
			const person = obj(item.identity);
			into.add({
				...common,
				kind: "identity",
				identity: {
					name: joined(
						person.title,
						person.firstName,
						person.middleName,
						person.lastName,
					),
					company: text(person.company),
					email: text(person.email),
					phone: text(person.phone),
					address: lines(person.address1, person.address2, person.address3),
					city: text(person.city),
					region: text(person.state),
					postalCode: text(person.postalCode),
					country: text(person.country),
					taxNumber: text(person.ssn),
				},
				fields: [
					{ label: "Username", value: text(person.username) },
					{
						label: "Passport number",
						value: text(person.passportNumber),
						hidden: true,
					},
					{
						label: "Licence number",
						value: text(person.licenseNumber),
						hidden: true,
					},
					...custom,
				],
			});
			continue;
		}
		into.add({
			...common,
			kind: type === 2 ? "note" : type === 5 ? "ssh-key" : "login",
			username: text(login.username),
			secret: type === 5 ? text(ssh.privateKey) : text(login.password),
			urls: objs(login.uris).map((uri) => text(uri.uri)),
			totp: text(login.totp),
			fields: [
				...(type === 5
					? [
							{ label: "Public key", value: text(ssh.publicKey) },
							{ label: "Fingerprint", value: text(ssh.keyFingerprint) },
						]
					: []),
				...custom,
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

/** Which of a 1Password Credit Card's fields hold the card itself. */
const onePasswordCard: Record<string, keyof Card> = {
	cardholder: "cardholder",
	ccnum: "number",
	cvv: "code",
	expiry: "expiry",
	pin: "pin",
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
								: category === "002"
									? "card"
									: category === "004"
										? "identity"
										: "login",
				...(category === "002" && { card: {} }),
				...(category === "004" && { identity: {} }),
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
		else draft.fields.push({ label, value: text(raw), hidden: true });
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
	const card = draft.card;
	if (card) {
		const role = onePasswordCard[id];
		if (role && !card[role]) {
			card[role] = value;
			return;
		}
		// The brand comes from the number.
		if (id === "type") return;
	}
	const identity = draft.identity;
	if (identity) {
		if (id === "firstname" || id === "initial" || id === "lastname") {
			identity.name = joined(identity.name, value);
			return;
		}
		if (kind === "address" && !identity.address) {
			const place = obj(raw);
			identity.address = text(place.street);
			identity.city = text(place.city);
			identity.region = text(place.state);
			identity.postalCode = text(place.zip);
			identity.country = text(place.country).toUpperCase();
			return;
		}
		const role = (
			{ company: "company", email: "email", defphone: "phone" } as const
		)[id];
		if (role && !identity[role]) {
			identity[role] = value;
			return;
		}
	}
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
	draft.fields.push({ label, value, hidden: kind === "concealed" });
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
					else fields.push({ label, value: text(value.totpUri), hidden: true });
				} else if (field.type === "timestamp") {
					fields.push({ label, value: protonDate(value.timestamp) });
				} else {
					fields.push({
						label,
						value: text(value.content),
						hidden: field.type === "hidden",
					});
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
			if (type === "creditCard") {
				into.add({
					...draft,
					kind: "card",
					card: {
						cardholder: text(content.cardholderName),
						number: text(content.number),
						expiry: text(content.expirationDate),
						code: text(content.verificationNumber),
						pin: text(content.pin),
					},
				});
			} else if (type === "identity") {
				const { identity, fields: more } = protonIdentity(content);
				into.add({
					...draft,
					kind: "identity",
					identity,
					fields: [...more, ...fields],
				});
			} else if (type === "login") {
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

/** What Proton Pass's identity holds that vauly's has no place for: it becomes fields. */
const protonFields: [string, string, boolean?][] = [
	["passportNumber", "Passport number", true],
	["licenseNumber", "Licence number", true],
	["birthdate", "Date of birth"],
	["gender", "Gender"],
	["jobTitle", "Job title"],
	["workEmail", "Work email"],
	["workPhoneNumber", "Work phone"],
	["secondPhoneNumber", "Other phone"],
	["website", "Website"],
	["personalWebsite", "Personal website"],
	["xHandle", "X"],
	["linkedin", "LinkedIn"],
	["facebook", "Facebook"],
	["instagram", "Instagram"],
	["reddit", "Reddit"],
	["yahoo", "Yahoo"],
	["floor", "Floor"],
	["county", "County"],
];

function protonIdentity(content: Json): {
	identity: Identity;
	fields: Field[];
} {
	const extra = [
		"extraPersonalDetails",
		"extraAddressDetails",
		"extraContactDetails",
		"extraWorkDetails",
	].flatMap((key) =>
		objs(content[key]).map((field) => ({
			label: text(field.fieldName),
			value: text(obj(field.data).content),
			hidden: field.type === "hidden",
		})),
	);
	return {
		identity: {
			name:
				text(content.fullName) ||
				joined(content.firstName, content.middleName, content.lastName),
			company: text(content.company) || text(content.organization),
			email: text(content.email),
			phone: text(content.phoneNumber),
			address: text(content.streetAddress),
			city: text(content.city),
			region: text(content.stateOrProvince),
			postalCode: text(content.zipOrPostalCode),
			country: text(content.countryOrRegion),
			taxNumber: text(content.socialSecurityNumber),
		},
		fields: [
			...protonFields.map(([key, label, hidden]) => ({
				label,
				value: text(content[key]),
				hidden,
			})),
			...extra,
		],
	};
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
		if (category === "finance" || category === "travel") {
			into.leave("record");
			continue;
		}
		const draft: Draft & { fields: Field[]; urls: string[] } = {
			name: text(item.title),
			notes: text(item.note),
			urls: [],
			fields: [],
			...(category === "creditcard" && { card: {} }),
			...(category === "identity" && { identity: {} }),
		};
		for (const field of objs(item.fields)) {
			const type = text(field.type);
			const value = text(field.value);
			if (field.deleted === 1 || type === "section" || !value.trim()) continue;
			if (draft.card && readEnpassCard(draft.card, type, value)) continue;
			if (
				draft.identity &&
				readEnpassIdentity(draft.identity, type, text(field.label), value)
			) {
				continue;
			}
			// On a card or an identity, a login's username and password are fields too.
			if (draft.card || draft.identity) {
				draft.fields.push({
					label: text(field.label) || type,
					value,
					hidden: field.sensitive === 1 || type === "password",
				});
			} else if ((type === "username" || type === "email") && !draft.username) {
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
				draft.fields.push({
					label: text(field.label) || type,
					value,
					hidden: field.sensitive === 1 || type === "password",
				});
			}
		}
		const [folder, ...tags] = list(item.folders)
			.map((id) => folderPath(text(id)))
			.filter(Boolean);
		const kind: ItemKind = draft.card
			? "card"
			: draft.identity
				? "identity"
				: category === "note" || category === "license"
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

/** Reads an Enpass Credit Card field into the card, by its type; false for the others. */
function readEnpassCard(card: Card, type: string, value: string) {
	const role = (
		{
			ccName: "cardholder",
			ccNumber: "number",
			ccCvc: "code",
			ccPin: "pin",
			ccExpiry: "expiry",
		} as const
	)[type];
	if (role && !card[role]) {
		card[role] = value;
		return true;
	}
	// The brand comes from the number.
	return type === "ccType";
}

/**
 * Reads an Enpass Identity field into the identity. Its fields are mostly plain text, so
 * they're known by their labels in Enpass's own template; false for the others.
 */
function readEnpassIdentity(
	identity: Identity,
	type: string,
	label: string,
	value: string,
) {
	const name = label.toLowerCase();
	if (/^(first|middle|last)\s*name$|^(full\s*)?name$/.test(name)) {
		identity.name = joined(identity.name, value);
		return true;
	}
	const role: keyof Identity | undefined =
		type === "email" || name === "email"
			? "email"
			: type === "phone" || /^(phone|mobile|telephone)/.test(name)
				? "phone"
				: /^(company|organi[sz]ation)$/.test(name)
					? "company"
					: /^(address|street)/.test(name)
						? "address"
						: /^(city|town)$/.test(name)
							? "city"
							: /^(state|province|region|county)$/.test(name)
								? "region"
								: /^(zip|post\s*code|postal\s*code|zip\s*code)$/.test(name)
									? "postalCode"
									: name === "country"
										? "country"
										: /social security|^ssn$|tax/.test(name)
											? "taxNumber"
											: undefined;
	if (!role) return false;
	if (role === "address" && identity.address) {
		identity.address = lines(identity.address, value);
		return true;
	}
	if (identity[role]) return false;
	identity[role] = value;
	return true;
}

// Keeper: https://docs.keeper.io/en/user-guides/import-records-1/import-json

const keeperLeftovers: Record<string, Leftover> = {
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
	const records = objs(root.records);
	const byUid = new Map(records.map((record) => [text(record.uid), record]));
	for (const record of records) {
		const type = text(record.$type);
		const leftover = keeperLeftovers[type];
		if (leftover) {
			into.leave(leftover);
			continue;
		}
		if (type === "bankCard" || type === "address" || type === "contact") {
			into.add(keeperDetails(record, type, byUid));
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

/** The value of a Keeper field such as "$text:cardholderName" or "$address::1". */
function keeperValue(fields: Json, base: string, label = "") {
	for (const [key, value] of Object.entries(fields)) {
		const [type = "", name = ""] = key.split(":");
		if (type === base && (!label || name === label)) {
			return list(value).length > 0 ? list(value)[0] : value;
		}
	}
	return undefined;
}

/** Keeper's address field as an identity's. */
function keeperAddress(value: unknown): Identity {
	const place = obj(value);
	return {
		address: lines(place.street1, place.street2),
		city: text(place.city),
		region: text(place.state),
		postalCode: text(place.zip),
		country: text(place.country),
	};
}

const keeperUsed = new Set([
	"$paymentCard",
	"$pinCode",
	"$address",
	"$name",
	"$email",
	"$phone",
]);

/**
 * A Keeper Payment Card, Address or Contact as a card or an identity. A contact's address
 * is another record it refers to. Everything else on it becomes fields.
 */
function keeperDetails(
	record: Json,
	type: "bankCard" | "address" | "contact",
	byUid: Map<string, Json>,
): Draft {
	const fields = obj(record.custom_fields);
	const payment = obj(keeperValue(fields, "$paymentCard"));
	const person = obj(keeperValue(fields, "$name"));
	const referenced = byUid.get(
		text(keeperValue(obj(record.references), "$addressRef")),
	);
	const address = keeperAddress(
		keeperValue(fields, "$address") ??
			keeperValue(obj(referenced?.custom_fields), "$address"),
	);
	const rest: Field[] = Object.entries(fields)
		.filter(([key]) => {
			const [base = "", label = ""] = key.split(":");
			if (keeperUsed.has(base)) return false;
			return !(
				base === "$text" &&
				(label === "cardholderName" || label === "company")
			);
		})
		.map(([key, value]) => ({ label: keeperLabel(key), value: show(value) }));
	const draft: Draft = {
		name: text(record.title),
		notes: text(record.notes),
		urls: [text(record.login_url)],
		fields: rest,
	};
	if (type === "bankCard") {
		return {
			...draft,
			kind: "card",
			card: {
				cardholder: text(keeperValue(fields, "$text", "cardholderName")),
				number: text(payment.cardNumber),
				expiry: text(payment.cardExpirationDate),
				code: text(payment.cardSecurityCode),
				pin: text(keeperValue(fields, "$pinCode")),
			},
		};
	}
	return {
		...draft,
		kind: "identity",
		identity: {
			name: joined(person.first, person.middle, person.last),
			company: text(keeperValue(fields, "$text", "company")),
			email: text(keeperValue(fields, "$email")),
			phone: text(obj(keeperValue(fields, "$phone")).number),
			...address,
		},
	};
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
