/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { gzipSync, strToU8, zipSync } from "fflate";

import { ImportError, LockedExport, parseImport, readImport } from ".";
import { fixtureText } from "./fixtures";
import { keePassTime } from "./keepass";
import { parseXml } from "./xml";

describe("KeePass XML", () => {
	test("KeePass: groups, tags, custom fields, history and its one-time codes", () => {
		const result = parseImport(fixtureText("keepass.xml"));
		expect(result.source).toBe("KeePass");
		expect(result.left).toEqual({ trashed: 1 });
		// Its attachment, kept compressed in Meta, comes as a file on its item.
		const mail = result.items.find((item) => item.name === "Mail & Calendar");
		const attached = mail && result.files?.get(mail);
		expect(attached?.map((file) => file.name)).toEqual(["codes.txt"]);
		expect(new TextDecoder().decode(attached?.[0]?.data)).toBe(
			"example code 1\nexample code 2\n",
		);
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
				notes: "line 1\nline 2",
				tags: ["Work", "email", "work"],
				fields: [
					{
						label: "Recovery code",
						value: "example-recovery",
						hidden: true,
					},
				],
				history: [
					{
						secret: "example-old-1",
						until: "2025-02-01T09:30:00.000Z",
					},
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

	test("other XML is turned away, and the database asks for its password", () => {
		expect(() => parseImport("<html><body>hi</body></html>")).toThrow(
			ImportError,
		);
		// kdbx.test.ts opens it.
		expect(() =>
			readImport(
				new Uint8Array([0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]),
			),
		).toThrow(LockedExport);
	});
});

test("an XML export's attachments come as files, within what may be unpacked", () => {
	const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
	const text = (value: string) => new TextEncoder().encode(value);
	// Says it unpacks to 300 MiB: refused before anything is unpacked.
	const huge = gzipSync(text("x"));
	new DataView(huge.buffer).setUint32(huge.length - 4, 300 * 1024 * 1024, true);
	const entry = (title: string, binaries: string) =>
		`<Entry><UUID>${base64(text(title.padEnd(16)))}</UUID><String><Key>Title</Key><Value>${title}</Value></String><String><Key>Password</Key><Value>example-pass</Value></String>${binaries}</Entry>`;
	const parsed = parseImport(`<?xml version="1.0" encoding="utf-8"?>
<KeePassFile>
	<Meta>
		<Generator>KeePass</Generator>
		<Binaries>
			<Binary ID="0" Compressed="True">${base64(gzipSync(text("example certificate")))}</Binary>
			<Binary ID="1">${base64(text("example notes"))}</Binary>
			<Binary ID="2" Compressed="True">${base64(huge)}</Binary>
		</Binaries>
	</Meta>
	<Root><Group><Name>Example</Name>
		${entry(
			"Server",
			`<Binary><Key>server.p12</Key><Value Ref="0" /></Binary>
			<Binary><Key>notes.txt</Key><Value Ref="1" /></Binary>
			<Binary><Key>inline.txt</Key><Value>${base64(text("example inline"))}</Value></Binary>
			<Binary><Key>disk.img</Key><Value Ref="2" /></Binary>
			<Binary><Key>gone.txt</Key><Value Ref="9" /></Binary>`,
		)}
		${entry("Backup", `<Binary><Key>copy.p12</Key><Value Ref="0" /></Binary>`)}
	</Group></Root>
</KeePassFile>`);
	const filesOf = (name: string) => {
		const item = parsed.items.find((one) => one.name === name);
		return (item && parsed.files?.get(item))?.map((file) => [
			file.name,
			new TextDecoder().decode(file.data),
		]);
	};
	expect(filesOf("Server")).toEqual([
		["server.p12", "example certificate"],
		["notes.txt", "example notes"],
		["inline.txt", "example inline"],
	]);
	// Kept once in Meta, it goes with each entry that refers to it.
	expect(filesOf("Backup")).toEqual([["copy.p12", "example certificate"]]);
	// One that would unpack past the limit, and one whose ID isn't there.
	expect(parsed.left).toEqual({ attachment: 2 });
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
