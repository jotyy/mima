/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import { ImportError, parseCsv, parseImport, sameItem } from "./import";

// Every value here is made up; the headers match each app's real export.

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
});

describe("parseImport", () => {
	test("Bitwarden: logins and notes, skipping cards", () => {
		const result = parseImport(
			[
				"folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
				"Work,1,login,GitHub,,,0,https://github.com,alex@example.test,example-pass-1,JBSWY3DPEHPK3PXP",
				",,note,Wi-Fi,guest network: example-only,,0,,,,",
				",,card,Visa,,,0,,,,",
			].join("\n"),
		);
		expect(result.source).toBe("Bitwarden");
		expect(result.skipped).toBe(1);
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "example-pass-1",
				url: "https://github.com",
				totp: "JBSWY3DPEHPK3PXP",
				tags: ["Work"],
			},
			{ kind: "note", name: "Wi-Fi", notes: "guest network: example-only" },
		]);
	});

	test("1Password", () => {
		const result = parseImport(
			[
				"Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes",
				"Stripe,https://dashboard.stripe.com,ops@example.test,example-pass-2,,false,false,billing,Live account",
			].join("\n"),
		);
		expect(result.source).toBe("1Password");
		expect(result.items[0]).toMatchObject({
			name: "Stripe",
			username: "ops@example.test",
			secret: "example-pass-2",
			tags: ["billing"],
			notes: "Live account",
		});
	});

	test("Chrome, with a bare domain", () => {
		const result = parseImport(
			"name,url,username,password,note\nexample.test,example.test/login,sam,example-pass-3,",
		);
		expect(result.source).toBe("Chrome");
		expect(result.items[0]).toMatchObject({
			name: "example.test",
			url: "https://example.test/login",
			secret: "example-pass-3",
		});
	});

	test("Firefox names items after the site", () => {
		const result = parseImport(
			[
				"url,username,password,httpRealm,formActionOrigin,guid,timeCreated,timeLastUsed,timePasswordChanged",
				'"https://www.example.test","sam","example-pass-4",,"https://www.example.test","{0}","1","1","1"',
			].join("\n"),
		);
		expect(result.source).toBe("Firefox");
		expect(result.items[0]?.name).toBe("example.test");
	});

	test("LastPass secure notes", () => {
		const result = parseImport(
			[
				"url,username,password,totp,extra,name,grouping,fav",
				"http://sn,,,,Door code is example-1234,Office,Shared-Ops,0",
			].join("\n"),
		);
		expect(result.source).toBe("LastPass");
		expect(result.items[0]).toEqual({
			kind: "note",
			name: "Office",
			notes: "Door code is example-1234",
			tags: ["Shared-Ops"],
		});
	});

	test("skips rows with nothing to keep", () => {
		const result = parseImport(
			"name,url,username,password\nEmpty,https://example.test,,",
		);
		expect(result.items).toEqual([]);
		expect(result.skipped).toBe(1);
	});

	test("rejects files that aren't password exports", () => {
		expect(() => parseImport("city,country\nOslo,Norway")).toThrow(ImportError);
		expect(() => parseImport("")).toThrow(ImportError);
	});
});

test("sameItem ignores case in the name only", () => {
	const a = { kind: "login" as const, name: "GitHub", secret: "x" };
	expect(sameItem(a, { ...a, name: "github" })).toBe(true);
	expect(sameItem(a, { ...a, secret: "y" })).toBe(false);
});
