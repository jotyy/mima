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
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP",
			notes:
				"Recovery codes are in the safe.\n\nOther website: https://gist.example.test\nrecovery email: backup@acme.test",
			tags: ["Private", "Work/Dev"],
			history: [{ secret: "example-old-1", until: "2023-07-22T04:26:40.000Z" }],
		});
	});

	test("API credentials, SSH keys, notes and databases find their kind", () => {
		const [, stripe, deploy, door, postgres] = result.items;
		expect(stripe).toEqual({
			kind: "api-key",
			name: "Stripe key",
			username: "ops",
			secret: "sk_example_1",
			url: "https://api.example.test",
			notes: "type: other\nexpires: 2030-01-01",
			tags: ["Private", "Archived"],
		});
		expect(deploy).toMatchObject({
			kind: "ssh-key",
			secret:
				"-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
			notes:
				"Public key: ssh-ed25519 AAAAexample deploy@prod\nFingerprint: SHA256:example",
		});
		expect(door).toMatchObject({ kind: "note", notes: "Front: example-0000" });
		expect(postgres).toMatchObject({
			kind: "login",
			username: "app",
			secret: "example-pass-2",
			url: "https://db.example.test",
			notes: "type: postgresql\nport: 5432",
		});
	});

	test("cards and files are named, not imported", () => {
		expect(result.left).toEqual({ card: 1, attachment: 1 });
	});
});

describe("Bitwarden JSON", () => {
	test("logins, SSH keys and notes, with folders, fields and history", () => {
		const result = parseImport(fixtureText("bitwarden.json"));
		expect(result.source).toBe("Bitwarden");
		expect(result.left).toEqual({ passkey: 1, card: 1, identity: 1 });
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "prod-db",
				username: "admin",
				secret: "example-pass-1",
				url: "https://db.example.test",
				totp: "JBSWY3DPEHPK3PXP",
				notes:
					"primary\n\nOther website: https://db2.example.test\nport: 5432\napi key: k_example",
				tags: ["Work/Servers"],
				history: [
					{ secret: "example-old-1", until: "2025-01-01T00:00:00.000Z" },
				],
			},
			{
				kind: "ssh-key",
				name: "deploy key",
				secret: privateKey,
				notes:
					"Public key: ssh-ed25519 AAAAexample\nFingerprint: SHA256:example",
			},
			{ kind: "note", name: "Wi-Fi", notes: "guest network: example-only" },
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
			card: 1,
		});
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "Shop",
				username: "alex",
				secret: "example-pass-1",
				url: "https://shop.example.test",
				totp: "otpauth://totp/Shop:alex?secret=JBSWY3DPEHPK3PXP&issuer=Shop",
				notes:
					"Loyalty account\n\nOther website: https://checkout.example.test\nEmail: alex@example.test\nPIN: 0420",
				tags: ["Personal/Work/Shops"],
			},
			{
				kind: "login",
				name: "Office Wi-Fi",
				secret: "example-wifi",
				notes: "Network name: AcmeGuest",
				tags: ["Personal"],
			},
			{
				kind: "api-key",
				name: "Mail API",
				secret: "key_example_1",
				notes: "Details · Host: smtp.example.test",
				tags: ["Team"],
			},
			{
				kind: "ssh-key",
				name: "Backup server",
				secret: privateKey,
				notes: "Public key: ssh-ed25519 AAAAexample",
				tags: ["Team"],
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
		expect(result.left).toEqual({ card: 1, record: 2, identity: 1 });
		expect(result.items).toEqual([
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
				notes: "Other username: sam.alt",
			},
			{ kind: "note", name: "Door codes", notes: "Front: example-0000" },
		]);
	});

	test("the old JSON export asks for a CSV instead", () => {
		expect(() => parseImport('{"AUTHENTIFIANT":[]}')).toThrow("CSV");
	});
});

test("Enpass: tags, one-time codes, archived and trashed items", () => {
	const result = parseImport(fixtureText("enpass.json"));
	expect(result.source).toBe("Enpass");
	expect(result.left).toEqual({ card: 1, trashed: 1 });
	expect(result.items).toEqual([
		{
			kind: "login",
			name: "Social",
			username: "alex",
			secret: "example-pass-1",
			url: "https://social.example.test",
			totp: "JBSWY3DPEHPK3PXP",
			notes: "E-mail: alex@example.test",
			tags: ["Work/Clients"],
		},
		{
			kind: "login",
			name: "Prod DB",
			username: "app",
			secret: "example-pass-2",
			notes: "Primary\n\nHost: db.example.test",
			tags: ["Archived"],
		},
		{ kind: "note", name: "Server room", notes: "Code: example-0000" },
	]);
});

test("Keeper JSON: record types, shared folders and key pairs", () => {
	const result = parseImport(fixtureText("keeper.json"));
	expect(result.source).toBe("Keeper");
	expect(result.left).toEqual({ card: 1 });
	expect(result.items).toEqual([
		{
			kind: "login",
			name: "GitHub",
			username: "alex@example.test",
			secret: "example-pass-1",
			url: "https://github.example.test",
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP",
			notes:
				"work account\n\nOther website: https://gist.example.test\nTeam: Ops\nSecurity question: First pet?, example-answer",
			tags: ["Work/Dev", "Team/Ops"],
		},
		{
			kind: "ssh-key",
			name: "Build server",
			username: "deploy",
			secret: privateKey,
			url: "https://build.example.test:22",
			notes:
				"Passphrase: example-passphrase\nPublic key: ssh-ed25519 AAAAexample",
			tags: ["Team/Ops/Servers"],
		},
		{
			kind: "note",
			name: "Alarm code",
			notes: "example-1234\n\nDate: 2030-01-01",
		},
	]);
});

test("JSON nobody wrote is turned away", () => {
	expect(() => parseImport('{"hello":"world"}')).toThrow(ImportError);
	expect(() => parseImport("{not json")).toThrow(ImportError);
});
