/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { ImportError, parseImport, readImport } from ".";
import {
	dashlaneZip,
	fixture,
	fixtureText,
	onePux,
	protonPassZip,
} from "./fixtures";

/** Everything but cards and identities, which "cards and identities" below checks. */
const others = <T extends { kind: string }>(items: T[]) =>
	items.filter((item) => item.kind !== "card" && item.kind !== "identity");

const privateKey =
	"-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----";

describe("1Password .1pux", () => {
	const result = readImport(onePux());

	test("reads every vault, and tags items with theirs", () => {
		expect(result.source).toBe("1Password");
		expect(result.format).toBe("1PUX");
		expect(result.folders).toEqual(["Private", "Engineering"]);
		expect(result.items.map((item) => item.name)).toEqual([
			"GitHub",
			"Stripe key",
			"deploy@prod",
			"Door codes",
			"Company card",
			"Alex Example",
			"Postgres staging",
		]);
	});

	test("a login keeps its one-time code, addresses, fields and old password", () => {
		expect(result.items[0]).toEqual({
			kind: "login",
			name: "GitHub",
			username: "alex@acme.test",
			secret: "example-pass-1",
			url: "https://github.example.test",
			moreUrls: ["https://gist.example.test"],
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP",
			notes: "Recovery codes are in the safe.",
			tags: ["Private", "Work/Dev"],
			fields: [
				{
					label: "recovery email",
					value: "backup@acme.test",
				},
				// Concealed in 1Password, so hidden here.
				{
					hidden: true,
					label: "recovery PIN",
					value: "example-4711",
				},
			],
			history: [
				{
					secret: "example-old-1",
					until: "2023-07-22T04:26:40.000Z",
				},
			],
		});
	});

	test("API credentials, SSH keys, notes and databases find their kind", () => {
		const [, stripe, deploy, door, postgres] = others(result.items);
		expect(stripe).toEqual({
			kind: "api-key",
			name: "Stripe key",
			username: "ops",
			secret: "sk_example_1",
			url: "https://api.example.test",
			tags: ["Private", "Archived"],
			fields: [
				{
					label: "type",
					value: "other",
				},
				{
					label: "expires",
					value: "2030-01-01",
				},
			],
		});
		expect(deploy).toMatchObject({
			kind: "ssh-key",
			secret:
				"-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
			fields: [
				{ label: "Public key", value: "ssh-ed25519 AAAAexample deploy@prod" },
				{ label: "Fingerprint", value: "SHA256:example" },
			],
		});
		expect(door).toMatchObject({ kind: "note", notes: "Front: example-0000" });
		expect(postgres).toMatchObject({
			kind: "login",
			username: "app",
			secret: "example-pass-2",
			url: "https://db.example.test",
			fields: [
				{ label: "type", value: "postgresql" },
				{ label: "port", value: "5432" },
			],
		});
	});

	test("files are named, not imported", () => {
		expect(result.left).toEqual({ attachment: 1 });
	});
});

describe("Bitwarden JSON", () => {
	test("logins, SSH keys and notes, with folders, fields and history", () => {
		const result = parseImport(fixtureText("bitwarden.json"));
		expect(result.source).toBe("Bitwarden");
		expect(result.left).toEqual({ passkey: 1 });
		expect(others(result.items)).toEqual([
			{
				kind: "login",
				name: "prod-db",
				username: "admin",
				secret: "example-pass-1",
				url: "https://db.example.test",
				moreUrls: ["https://db2.example.test"],
				totp: "JBSWY3DPEHPK3PXP",
				notes: "primary",
				tags: ["Work/Servers"],
				fields: [
					{
						label: "port",
						value: "5432",
					},
					{
						label: "api key",
						value: "k_example",
						hidden: true,
					},
				],
				history: [
					{
						secret: "example-old-1",
						until: "2025-01-01T00:00:00.000Z",
					},
				],
			},
			{
				kind: "ssh-key",
				name: "deploy key",
				secret: privateKey,
				fields: [
					{
						label: "Public key",
						value: "ssh-ed25519 AAAAexample",
					},
					{
						label: "Fingerprint",
						value: "SHA256:example",
					},
				],
			},
			{
				kind: "note",
				name: "Wi-Fi",
				notes: "guest network: example-only",
			},
		]);
	});

	test("an organization's collections become tags", () => {
		const result = parseImport(
			JSON.stringify({
				encrypted: false,
				collections: [
					{ id: "c1", name: "Engineering" },
					{ id: "c2", name: "Ops" },
				],
				items: [
					{
						type: 1,
						name: "AWS",
						collectionIds: ["c1", "c2"],
						login: { username: "root", password: "example-pass-7" },
					},
				],
			}),
		);
		expect(result.items[0]?.tags).toEqual(["Engineering", "Ops"]);
	});

	test("the ZIP with attachments", () => {
		const result = readImport(
			zipSync({
				"data.json": fixture("bitwarden.json"),
				"attachments/prod-db/notes.json": strToU8("{}"),
			}),
		);
		expect(result.source).toBe("Bitwarden");
		expect(result.left.attachment).toBe(1);
	});

	test("an encrypted export is turned away", () => {
		expect(() =>
			parseImport(
				'{"encrypted":true,"passwordProtected":true,"salt":"x","data":"2.x|y|z"}',
			),
		).toThrow("encrypted");
	});
});

describe("Proton Pass", () => {
	test("the ZIP: vaults and folders, Wi-Fi, custom items and SSH keys", () => {
		const result = readImport(protonPassZip());
		expect(result.source).toBe("Proton Pass");
		expect(result.left).toEqual({
			passkey: 1,
			trashed: 1,
			alias: 1,
		});
		expect(others(result.items)).toEqual([
			{
				kind: "login",
				name: "Shop",
				username: "alex",
				secret: "example-pass-1",
				url: "https://shop.example.test",
				moreUrls: ["https://checkout.example.test"],
				totp: "otpauth://totp/Shop:alex?secret=JBSWY3DPEHPK3PXP&issuer=Shop",
				notes: "Loyalty account",
				tags: ["Personal/Work/Shops"],
				fields: [
					{
						label: "Email",
						value: "alex@example.test",
					},
					{
						label: "PIN",
						value: "0420",
						hidden: true,
					},
				],
			},
			{
				kind: "login",
				name: "Office Wi-Fi",
				secret: "example-wifi",
				tags: ["Personal"],
				fields: [
					{
						label: "Network name",
						value: "AcmeGuest",
					},
				],
			},
			{
				kind: "api-key",
				name: "Mail API",
				secret: "key_example_1",
				tags: ["Team"],
				fields: [
					{
						label: "Details · Host",
						value: "smtp.example.test",
					},
				],
			},
			{
				kind: "ssh-key",
				name: "Backup server",
				secret: privateKey,
				tags: ["Team"],
				fields: [
					{
						label: "Public key",
						value: "ssh-ed25519 AAAAexample",
					},
				],
			},
		]);
	});

	test("a PGP-encrypted export is turned away", () => {
		const encrypted = zipSync({
			"Proton Pass/data.pgp": strToU8("-----BEGIN PGP MESSAGE-----"),
		});
		expect(() => readImport(encrypted)).toThrow("PGP");
		expect(() => parseImport("-----BEGIN PGP MESSAGE-----\nxyz")).toThrow(
			ImportError,
		);
	});
});

describe("Dashlane", () => {
	test("the ZIP of CSVs", () => {
		const result = readImport(dashlaneZip());
		expect(result.source).toBe("Dashlane");
		// The bank account stays behind; the passport joins the identity.
		expect(result.left).toEqual({ record: 1 });
		expect(others(result.items)).toEqual([
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "example-pass-1",
				url: "https://github.example.test",
				totp: "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30&lock=false",
				notes: "line 1\nline 2",
				tags: ["Work"],
			},
			{
				kind: "login",
				name: "Forum",
				username: "sam",
				secret: "example-pass-2",
				url: "https://forum.example.test",
				fields: [
					{
						label: "Other username",
						value: "sam.alt",
					},
				],
			},
			{
				kind: "note",
				name: "Door codes",
				notes: "Front: example-0000",
			},
		]);
	});

	test("the old JSON export asks for a CSV instead", () => {
		expect(() => parseImport('{"AUTHENTIFIANT":[]}')).toThrow("CSV");
	});
});

test("Enpass: tags, one-time codes, archived and trashed items", () => {
	const result = parseImport(fixtureText("enpass.json"));
	expect(result.source).toBe("Enpass");
	expect(result.left).toEqual({ trashed: 1 });
	expect(others(result.items)).toEqual([
		{
			kind: "login",
			name: "Social",
			username: "alex",
			secret: "example-pass-1",
			url: "https://social.example.test",
			totp: "JBSWY3DPEHPK3PXP",
			tags: ["Work/Clients"],
			fields: [
				{
					label: "E-mail",
					value: "alex@example.test",
				},
				// Sensitive in Enpass, so hidden here.
				{
					hidden: true,
					label: "Security answer",
					value: "example-answer",
				},
			],
		},
		{
			kind: "login",
			name: "Prod DB",
			username: "app",
			secret: "example-pass-2",
			notes: "Primary",
			tags: ["Archived"],
			fields: [
				{
					label: "Host",
					value: "db.example.test",
				},
			],
		},
		{
			kind: "note",
			name: "Server room",
			notes: "Code: example-0000",
		},
	]);
});

test("Keeper JSON: record types, shared folders and key pairs", () => {
	const result = parseImport(fixtureText("keeper.json"));
	expect(result.source).toBe("Keeper");
	expect(result.left).toEqual({});
	expect(others(result.items)).toEqual([
		{
			kind: "login",
			name: "GitHub",
			username: "alex@example.test",
			secret: "example-pass-1",
			url: "https://github.example.test",
			moreUrls: ["https://gist.example.test"],
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP",
			notes: "work account",
			tags: ["Work/Dev", "Team/Ops"],
			fields: [
				{
					label: "Team",
					value: "Ops",
				},
				{
					label: "Security question",
					value: "First pet?, example-answer",
				},
			],
		},
		{
			kind: "ssh-key",
			name: "Build server",
			username: "deploy",
			secret: privateKey,
			url: "https://build.example.test:22",
			tags: ["Team/Ops/Servers"],
			fields: [
				{
					label: "Passphrase",
					value: "example-passphrase",
				},
				{
					label: "Public key",
					value: "ssh-ed25519 AAAAexample",
				},
			],
		},
		{
			kind: "note",
			name: "Alarm code",
			notes: "example-1234",
			fields: [
				{
					label: "Date",
					value: "2030-01-01",
				},
			],
		},
	]);
});

test("JSON nobody wrote is turned away", () => {
	expect(() => parseImport('{"hello":"world"}')).toThrow(ImportError);
	expect(() => parseImport("{not json")).toThrow(ImportError);
});

describe("cards and identities", () => {
	const card = {
		cardholder: "Alex Example",
		number: "4111111111111111",
		expiry: "06/2030",
		code: "123",
	};
	const details = <T extends { kind: string }>(items: T[]) => ({
		cards: items.filter((item) => item.kind === "card"),
		identities: items.filter((item) => item.kind === "identity"),
	});

	test("Bitwarden: types 3 and 4, with passport and licence numbers hidden", () => {
		const { cards, identities } = details(
			parseImport(fixtureText("bitwarden.json")).items,
		);
		expect(cards).toEqual([
			{
				kind: "card",
				name: "Visa",
				card,
				fields: [{ label: "Issuing bank", value: "Example Bank" }],
			},
		]);
		expect(identities).toEqual([
			{
				kind: "identity",
				name: "Me",
				identity: {
					name: "Mx Alex J Example",
					company: "Acme Ltd",
					email: "alex@example.test",
					phone: "555-0100",
					address: "1 Example Street\nUnit 2",
					city: "Springfield",
					region: "IL",
					postalCode: "00000",
					country: "US",
					taxNumber: "000-00-0000",
				},
				fields: [
					{ label: "Username", value: "alexample" },
					{ label: "Passport number", value: "X0000000", hidden: true },
					{ label: "Licence number", value: "D0000000", hidden: true },
				],
			},
		]);
	});

	test("1Password: a Credit Card and an Identity, the rest as fields", () => {
		const { cards, identities } = details(readImport(onePux()).items);
		expect(cards).toEqual([
			{
				kind: "card",
				name: "Company card",
				card: { ...card, pin: "0000" },
				tags: ["Private"],
				fields: [
					{ label: "Additional Details · issuing bank", value: "Example Bank" },
				],
			},
		]);
		expect(identities[0]).toMatchObject({
			name: "Alex Example",
			identity: {
				name: "Alex J Example",
				company: "Acme Ltd",
				email: "alex@example.test",
				phone: "555-0100",
				address: "1 Example Street",
				city: "Springfield",
				region: "IL",
				postalCode: "00000",
				country: "US",
			},
			fields: [
				{ label: "Identification · job title", value: "Engineer" },
				{ label: "Address · mobile", value: "555-0101" },
			],
		});
	});

	test("Proton Pass: its social security number is the tax number", () => {
		const { cards, identities } = details(readImport(protonPassZip()).items);
		expect(cards[0]?.card).toEqual({ ...card, pin: "0000" });
		expect(identities[0]).toMatchObject({
			name: "Acme Ltd",
			identity: {
				name: "Alex Example",
				company: "Acme Ltd",
				taxNumber: "000-00-0000",
				country: "US",
			},
			fields: [
				{ label: "Passport number", value: "X0000000", hidden: true },
				{ label: "Job title", value: "Engineer" },
				{ label: "Billing contact", value: "accounts@acme.test" },
			],
		});
	});

	test("Enpass: a card's online banking login stays with it, as fields", () => {
		const { cards, identities } = details(
			parseImport(fixtureText("enpass.json")).items,
		);
		expect(cards[0]).toMatchObject({
			card: { ...card, pin: "0000" },
			fields: [
				{ label: "Username", value: "alexample" },
				{ label: "Login password", value: "example-bank-pass", hidden: true },
				{ label: "Issuing bank", value: "Example Bank" },
			],
		});
		expect(identities[0]).toMatchObject({
			identity: {
				name: "Alex Example",
				company: "Acme Ltd",
				email: "alex@example.test",
				postalCode: "00000",
			},
			fields: [{ label: "Passport number", value: "X0000000", hidden: true }],
		});
	});

	test("Keeper: a Payment Card, an Address, and a Contact", () => {
		const { cards, identities } = details(
			parseImport(fixtureText("keeper.json")).items,
		);
		expect(cards[0]).toMatchObject({
			card: { ...card, pin: "0000" },
			fields: [{ label: "Issuing bank", value: "Example Bank" }],
		});
		expect(identities.map((item) => item.identity)).toEqual([
			{
				address: "1 Example Street\nUnit 2",
				city: "Springfield",
				region: "IL",
				postalCode: "00000",
				country: "US",
			},
			{
				name: "Alex Example",
				company: "Acme Ltd",
				email: "alex@example.test",
				phone: "555-0100",
				// The Contact points at the Address record.
				address: "1 Example Street\nUnit 2",
				city: "Springfield",
				region: "IL",
				postalCode: "00000",
				country: "US",
			},
		]);
	});

	test("Dashlane: a payment card, and one identity from the personal info", () => {
		const { cards, identities } = details(readImport(dashlaneZip()).items);
		expect(cards).toEqual([
			{
				kind: "card",
				name: "Visa",
				card,
				fields: [{ label: "Country", value: "US" }],
			},
		]);
		expect(identities).toEqual([
			{
				kind: "identity",
				name: "Alex Example",
				identity: { name: "Alex Example", email: "alex@example.test" },
				fields: [{ label: "Passport number", value: "X0000000", hidden: true }],
			},
		]);
	});
});
