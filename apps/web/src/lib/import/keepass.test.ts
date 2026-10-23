/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { ImportError, parseImport, readImport } from ".";
import { fixtureText } from "./fixtures";
import { keePassTime } from "./keepass";
import { parseXml } from "./xml";

describe("KeePass XML", () => {
	test("KeePass: groups, tags, custom fields, history and its one-time codes", () => {
		const result = parseImport(fixtureText("keepass.xml"));
		expect(result.source).toBe("KeePass");
		expect(result.left).toEqual({ attachment: 1, trashed: 1 });
		expect(result.folders).toEqual(["Work", "Work/Servers"]);
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "Router",
				username: "admin",
				secret: "example-pass-0",
				url: "https://192.168.1.1",
			},
			{
				kind: "login",
				name: "Mail & Calendar",
				username: "alex",
				secret: 'p<w"d-example',
				url: "https://mail.example.test",
				totp: "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&period=60",
				notes: "line 1\nline 2\n\nRecovery code: example-recovery",
				tags: ["Work", "email", "work"],
				history: [
					{ secret: "example-old-1", until: "2025-02-01T09:30:00.000Z" },
				],
			},
			{
				// The secret was hex; vauly keeps base32.
				kind: "login",
				name: "Build",
				username: "ci",
				secret: "example-pass-2",
				totp: "JBSWY3DPEHPK3PXP",
				tags: ["Work/Servers"],
			},
		]);
	});

	test("KeePassXC: a translated root group, otp links and its dates", () => {
		const result = parseImport(fixtureText("keepassxc.xml"));
		expect(result.source).toBe("KeePassXC");
		expect(result.items).toEqual([
			{
				kind: "login",
				name: "Forum",
				username: "sam",
				secret: "example-pass-1",
				url: "https://forum.example.test",
				totp: "otpauth://totp/Forum:sam?secret=JBSWY3DPEHPK3PXP&period=30&digits=6&issuer=Forum",
				tags: ["Internet", "social", "personal"],
				history: [
					{ secret: "example-old-1", until: "2025-02-01T09:30:00.000Z" },
				],
			},
		]);
	});

	test("KeePassXC's times count seconds from year one", () => {
		expect(keePassTime("oAnE3Q4AAAA=")).toBe("2024-05-01T10:00:00.000Z");
		expect(keePassTime("2016-12-31T21:33:52Z")).toBe("2016-12-31T21:33:52Z");
	});

	test("other XML, and the encrypted database, are turned away", () => {
		expect(() => parseImport("<html><body>hi</body></html>")).toThrow(
			ImportError,
		);
		expect(() =>
			readImport(
				new Uint8Array([0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]),
			),
		).toThrow("encrypted KeePass database");
	});
});

test("parseXml reads entities, CDATA and self-closing tags", () => {
	const root = parseXml(
		'<?xml version="1.0"?><a x="1 &amp; 2"><b>&lt;&#65;&#x42;&gt;</b><c/><d><![CDATA[<raw>]]></d></a>',
	);
	expect(root.attrs.x).toBe("1 & 2");
	expect(root.children.map((node) => [node.name, node.text])).toEqual([
		["b", "<AB>"],
		["c", ""],
		["d", "<raw>"],
	]);
	expect(() => parseXml("<a><b></a>")).toThrow();
});

test("Safari's ZIP of browsing data: the passwords inside it", () => {
	const result = readImport(
		zipSync({
			"Safari Export/Bookmarks.html": strToU8("<html></html>"),
			"Safari Export/History.json": strToU8("{}"),
			"Safari Export/Passwords.csv": strToU8(
				fixtureText("apple-passwords.csv"),
			),
		}),
	);
	expect(result.source).toBe("Apple Passwords");
	expect(result.items).toHaveLength(2);
});
