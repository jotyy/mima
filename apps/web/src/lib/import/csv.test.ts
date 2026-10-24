/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
	type BackupRow,
	backupFilePath,
	toBackupCsv,
	toBackupZip,
} from "../backup";
import { ImportError, parseCsv, parseImport, readImport, sameItem } from ".";
import { fixture, fixtureText } from "./fixtures";

// Every value in the fixtures is made up; the headers match each app's real export.

describe("parseCsv", () => {
	test("handles quotes, doubled quotes, commas and line breaks in a field", () => {
		const rows = parseCsv(
			'﻿name,notes\r\n"Acme, Inc","says ""hi""\nline two"\r\n\r\nplain,',
		);
		expect(rows).toEqual([
			["name", "notes"],
			["Acme, Inc", 'says "hi"\nline two'],
			["plain", ""],
		]);
	});

	test("reads KeePass's backslash escapes when asked", () => {
		expect(parseCsv('"a\\"b","c\\\\d"', true)).toEqual([['a"b', "c\\d"]]);
	});
});

describe("CSV exports", () => {
	test("Bitwarden: logins and notes, leaving cards out", () => {
		const result = parseImport(fixtureText("bitwarden.csv"));
		expect(result.source).toBe("Bitwarden");
		expect(result.left).toEqual({ card: 1 });
		expect(result.folders).toEqual(["Work"]);
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "example-pass-1",
				url: "https://github.example.test",
				moreUrls: ["https://gist.example.test"],
				totp: "JBSWY3DPEHPK3PXP",
				tags: ["Work"],
				fields: [
					{
						label: "recovery",
						value: "example-code",
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

	test("1Password: archived items come over tagged", () => {
		const result = parseImport(fixtureText("1password.csv"));
		expect(result.source).toBe("1Password");
		expect(result.items[0]).toMatchObject({
			name: "Stripe",
			username: "ops@acme.test",
			secret: "example-pass-2",
			totp: "otpauth://totp/Stripe?secret=JBSWY3DPEHPK3PXP",
			tags: ["billing"],
			notes: "Live account",
		});
		expect(result.items[1]?.tags).toEqual(["Archived"]);
	});

	test("LastPass: folders, secure notes, typed notes and empty addresses", () => {
		const result = parseImport(fixtureText("lastpass.csv"));
		expect(result.source).toBe("LastPass");
		expect(result.left).toEqual({ card: 1 });
		expect(result.folders).toEqual(["Work/Dev", "Shared-Ops"]);
		const [github, router, office, deploy] = result.items;
		expect(github).toMatchObject({
			totp: "JBSWY3DPEHPK3PXP",
			tags: ["Work/Dev"],
		});
		expect(router?.url).toBeUndefined();
		expect(office).toEqual({
			kind: "note",
			name: "Office",
			notes: "Door code is example-1234",
			tags: ["Shared-Ops"],
		});
		expect(deploy).toMatchObject({
			kind: "ssh-key",
			name: "Deploy key",
			secret:
				"-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----",
		});
		expect(deploy?.notes).toBe("Rotate yearly.\nAsk ops first.");
		expect(deploy?.fields).toContainEqual({
			label: "Hostname",
			value: "deploy.example.test",
		});
	});

	test("LastPass, saved from the web page that shows the CSV", () => {
		const page = `<!DOCTYPE html><html><body><pre>${fixtureText("lastpass.csv")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")}</pre></body></html>`;
		const result = parseImport(page);
		expect(result.source).toBe("LastPass");
		expect(result.items).toHaveLength(4);
	});

	test("Dashlane's credentials.csv on its own", () => {
		const result = parseImport(fixtureText("dashlane/credentials.csv"));
		expect(result.source).toBe("Dashlane");
		expect(result.items[1]).toMatchObject({
			username: "sam",
			fields: [{ label: "Other username", value: "sam.alt" }],
		});
	});

	test("Keeper: no header, custom fields in pairs, one row per folder", () => {
		const result = parseImport(fixtureText("keeper.csv"));
		expect(result.source).toBe("Keeper");
		expect(result.items).toHaveLength(2);
		expect(result.items[0]).toMatchObject({
			name: "GitHub",
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP",
			tags: ["Work/Dev"],
		});
		expect(result.items[1]?.fields).toEqual([
			{ label: "Account ID", value: "12345" },
			{ label: "PIN", value: "0000" },
		]);
	});

	test("NordPass: folder rows, extra addresses and custom fields", () => {
		const result = parseImport(fixtureText("nordpass.csv"));
		expect(result.source).toBe("NordPass");
		expect(result.left).toEqual({ card: 1, identity: 1 });
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "example-pass-1",
				url: "https://github.example.test",
				moreUrls: ["https://gist.example.test"],
				notes: "work account",
				tags: ["Work"],
				fields: [
					{
						label: "API key",
						value: "abc123",
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

	test("RoboForm: quoted logins, fields past the header, bookmarks left out", () => {
		const result = readImport(fixture("roboform.csv"));
		expect(result.source).toBe("RoboForm");
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "@example-pass-1",
				url: "https://github.example.test/login",
				totp: "JBSWY3DPEHPK3PXP",
				tags: ["Work/Dev"],
				fields: [
					{
						label: "Team",
						value: "Ops, east",
					},
				],
			},
			{
				kind: "note",
				name: "Wifi code",
				notes: "SSID: home\nPSK: example-psk",
				tags: ["Personal"],
			},
		]);
		expect(result.left).toEqual({});
	});

	test("Proton Pass: email beside the username, vault as a folder", () => {
		const result = parseImport(fixtureText("proton-pass.csv"));
		expect(result.source).toBe("Proton Pass");
		expect(result.left).toEqual({ card: 1 });
		expect(result.items[0]).toMatchObject({
			username: "alex",
			url: "https://shop.example.test",
			moreUrls: ["https://checkout.example.test"],
			notes: "Loyalty account",
			fields: [{ label: "Email", value: "alex@example.test" }],
			tags: ["Personal"],
		});
	});

	test("KeePass: backslash escapes", () => {
		const result = parseImport(fixtureText("keepass.csv"));
		expect(result.source).toBe("KeePass");
		expect(result.items[0]).toMatchObject({
			name: "Router",
			secret: 'ex"ample\\pass',
			url: "https://192.168.1.1",
		});
		expect(result.items[1]?.notes).toBe("line 1\nline 2");
	});

	test("KeePassXC: the root group drops out, the Recycle Bin is left out", () => {
		const result = parseImport(fixtureText("keepassxc.csv"));
		expect(result.source).toBe("KeePassXC");
		expect(result.left).toEqual({ trashed: 1 });
		expect(result.items.map((item) => item.tags)).toEqual([
			["Work"],
			undefined,
		]);
		expect(result.items[0]?.totp).toStartWith("otpauth://totp/Forum:sam?");
	});

	test("Apple Passwords, with one-time codes", () => {
		const result = parseImport(fixtureText("apple-passwords.csv"));
		expect(result.source).toBe("Apple Passwords");
		expect(result.items[0]).toMatchObject({
			name: "github.example.test (alex)",
			totp: "otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30",
			notes: "Work account",
		});
	});

	test("Chrome, Edge and Brave, with and without the note column", () => {
		const result = parseImport(fixtureText("chrome.csv"));
		expect(result.source).toBe("Chrome");
		expect(result.items[1]?.notes).toBe("from the phone, saved");
		const older = parseImport(
			"name,url,username,password\nexample.test,example.test/login,sam,example-pass-3",
		);
		expect(older.source).toBe("Chrome");
		expect(older.items[0]).toMatchObject({
			name: "example.test",
			url: "https://example.test/login",
		});
	});

	test("Firefox: named after the site, without its sync key", () => {
		const result = parseImport(fixtureText("firefox.csv"));
		expect(result.source).toBe("Firefox");
		expect(result.items.map((item) => item.name)).toEqual([
			"example.test",
			"intranet.example.test",
		]);
	});

	test("any other CSV with a password column", () => {
		const result = parseImport(
			"Title,Login,Password,Website,Folder\nWiki,alex,example-pass-6,wiki.example.test,Team",
		);
		expect(result.source).toBe("CSV");
		expect(result.items[0]).toEqual({
			kind: "login",
			name: "Wiki",
			username: "alex",
			secret: "example-pass-6",
			url: "https://wiki.example.test",
			tags: ["Team"],
		});
	});

	test("counts rows with nothing to keep", () => {
		const result = parseImport(
			"name,url,username,password\nEmpty,https://example.test,,",
		);
		expect(result.items).toEqual([]);
		expect(result.left).toEqual({ empty: 1 });
	});

	test("turns away files that aren't password exports", () => {
		expect(() => parseImport("city,country\nOslo,Norway")).toThrow(ImportError);
		expect(() => parseImport("")).toThrow(ImportError);
	});
});

test("sameItem ignores case in the name only", () => {
	const a = { kind: "login" as const, name: "GitHub", secret: "x" };
	expect(sameItem(a, { ...a, name: "github" })).toBe(true);
	expect(sameItem(a, { ...a, secret: "y" })).toBe(false);
});

test("a vauly backup imports back to the same items", () => {
	const items: BackupRow[] = [
		{
			vault: "Engineering",
			kind: "login",
			name: "GitHub, main",
			username: "alex@example.test",
			secret: 'example "quoted" pass',
			url: "https://github.com",
			moreUrls: ["https://gist.github.com"],
			totp: "JBSWY3DPEHPK3PXP",
			tags: ["work", "code"],
			fields: [
				{ label: "Account ID", value: "12345" },
				{ label: "Recovery PIN", value: "4711", hidden: true },
				{ label: "Address", value: "1 Example Street\nSpringfield" },
			],
		},
		{
			vault: "Engineering",
			kind: "ssh-key",
			name: "deploy@prod",
			secret:
				"-----BEGIN EXAMPLE KEY-----\nnot-a-real-key\n-----END EXAMPLE KEY-----",
		},
		{
			vault: "Engineering",
			kind: "api-key",
			name: "Stripe",
			secret: "sk_example_1",
		},
		{
			vault: "Private",
			kind: "note",
			name: "Door codes",
			notes: "Front: example-0000",
		},
		{
			vault: "Engineering",
			kind: "card",
			name: "Company Visa",
			card: {
				cardholder: "Alex Example",
				number: "4111111111111111",
				expiry: "06/2030",
				code: "123",
				pin: "0000",
			},
			fields: [{ label: "Issuing bank", value: "Example Bank" }],
		},
		{
			vault: "Engineering",
			kind: "identity",
			name: "Acme Ltd",
			identity: {
				company: "Acme Ltd",
				email: "billing@acme.test",
				address: "1 Example Street\nUnit 2",
				city: "Springfield",
				postalCode: "00000",
				country: "US",
				taxNumber: "00-0000000",
			},
		},
	];
	const csv = toBackupCsv(items);
	// Other apps get a card as a note with its details among the fields.
	expect(csv).toContain("Number: 4111111111111111");
	const result = parseImport(csv);
	expect(result.source).toBe("vauly");
	expect(result.left).toEqual({});
	expect(result.items).toEqual(items.map(({ vault: _, ...fields }) => fields));
});

test("a backup's card details that aren't text are left out", () => {
	const csv = toBackupCsv([
		{
			vault: "Private",
			kind: "card",
			name: "Odd card",
			card: { cardholder: "Alex" },
		},
	]).replace(
		'{""cardholder"":""Alex""}',
		'{""number"":4111,""cardholder"":""Alex"",""code"":null}',
	);
	expect(csv).toContain('""number"":4111');
	const [item] = parseImport(csv).items;
	expect(item).toMatchObject({ kind: "card", card: { cardholder: "Alex" } });
	expect(item?.card).toEqual({ cardholder: "Alex" });
});

test("a backup ZIP brings each item's files back with it", () => {
	const key = new Uint8Array([1, 2, 3, 255]);
	const pdf = new TextEncoder().encode("%PDF- not a real one");
	const keyPath = backupFilePath(1, "deploy/key.pem");
	const pdfPath = backupFilePath(2, "..recovery.pdf");
	expect(keyPath).toBe("files/1/deploy_key.pem");
	expect(pdfPath).toBe("files/2/_recovery.pdf");
	const zip = toBackupZip(
		"vauly-backup-2026-10-24.csv",
		[
			{
				vault: "Engineering",
				kind: "ssh-key",
				name: "deploy",
				secret: "not-a-real-key",
				files: [keyPath],
			},
			// Nothing but a name and a file: it still comes back, for the file.
			{ vault: "Private", kind: "note", name: "Recovery", files: [pdfPath] },
			{ vault: "Private", kind: "note", name: "Plain", notes: "no files" },
		],
		new Map([
			[keyPath, key],
			[pdfPath, pdf],
		]),
	);
	const result = readImport(zip);
	expect(result.source).toBe("vauly");
	expect(result.format).toBe("ZIP");
	expect(result.left).toEqual({});
	const [deploy, recovery, plain] = result.items;
	expect(deploy).toMatchObject({ kind: "ssh-key", name: "deploy" });
	expect(recovery).toEqual({ kind: "note", name: "Recovery" });
	expect(result.files?.get(deploy as never)).toEqual([
		{ name: "deploy_key.pem", path: keyPath, data: key },
	]);
	expect(result.files?.get(recovery as never)?.[0]?.data).toEqual(pdf);
	expect(result.files?.has(plain as never)).toBe(false);
});
