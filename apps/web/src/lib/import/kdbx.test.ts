/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { gzipSync } from "fflate";
import * as kdbxweb from "kdbxweb";

import { ImportError, LockedExport, parseImport, readImport } from ".";
import { fixture } from "./fixtures";
import { KDBX_LIMITS } from "./kdbx-limits";
import { KdbxOpenError, keyFileKey, openKdbx } from "./kdbx-open";
import { parseKeePassXml } from "./keepass";

// KeePass databases opened in place of an XML export: written by fixtures/kdbx/make.ts
// with each app's settings, then read the way the import worker reads them.

const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
const file = (name: string) => buffer(fixture(`kdbx/${name}`));
const xml = async (opening: ReturnType<typeof openKdbx>) => (await opening).xml;

async function failure(work: Promise<unknown>) {
	try {
		await work;
	} catch (error) {
		return error as KdbxOpenError;
	}
	throw new Error("it opened");
}

/** The file with the 8-byte value after `marker` replaced, as a hostile file would have it. */
function patched(bytes: Uint8Array, marker: number[], value: bigint) {
	const copy = bytes.slice();
	for (let at = 0; at < copy.length - marker.length; at++) {
		if (marker.every((byte, i) => copy[at + i] === byte)) {
			new DataView(copy.buffer).setBigUint64(at + marker.length, value, true);
			return buffer(copy);
		}
	}
	throw new Error("marker not found");
}

describe("KeePass databases", () => {
	test("KeePass 2.x: KDBX 4 and Argon2d, mapped as its XML export would be", async () => {
		const bytes = fixture("kdbx/keepass.kdbx");
		// The import finds the lock; the dialog then asks for the password.
		expect(() => readImport(bytes)).toThrow(LockedExport);
		try {
			readImport(bytes);
		} catch (error) {
			expect((error as LockedExport).app).toBe("KeePass");
		}
		const result = parseImport(
			await xml(openKdbx(buffer(bytes), "example-keepass-password")),
		);
		expect(result.source).toBe("KeePass");
		expect(result.left).toEqual({ trashed: 1 });
		expect(result.items).toEqual([
			{ kind: "note", name: "Door codes", notes: "Front: example-0000" },
			{
				kind: "login",
				name: "GitHub",
				username: "alex@example.test",
				secret: "example-kdbx-pass-2",
				url: "https://github.com",
				totp: "JBSWY3DPEHPK3PXP",
				notes: "Recovery codes are in the safe.",
				tags: ["Work"],
				fields: [{ label: "PIN", value: "example-4711", hidden: true }],
				history: [{ secret: "example-kdbx-pass-1", until: expect.any(String) }],
			},
		]);
	});

	test("KeePassXC: Argon2id and a key file", async () => {
		const keyFile = file("keepassxc.keyx");
		const result = parseImport(
			await xml(
				openKdbx(file("keepassxc.kdbx"), "example-keepassxc-password", keyFile),
			),
		);
		// kdbxweb wrote the fixture, so it's the generator; a KeePassXC file names KeePassXC.
		expect(result.items[1]).toMatchObject({
			name: "GitHub",
			totp: expect.stringContaining("otpauth://totp/GitHub"),
		});
		// The password alone isn't enough.
		expect(
			(
				await failure(
					openKdbx(file("keepassxc.kdbx"), "example-keepassxc-password"),
				)
			).reason,
		).toBe("wrong-key");
	});

	test("KDBX 3.1 with AES-KDF", async () => {
		const result = parseImport(
			await xml(openKdbx(file("keepass-3.1.kdbx"), "example-kdbx3-password")),
		);
		expect(result.items.map((item) => item.name)).toEqual([
			"Door codes",
			"GitHub",
		]);
	});

	test("a wrong password says so", async () => {
		const error = await failure(
			openKdbx(file("keepass.kdbx"), "not the password"),
		);
		expect(error).toBeInstanceOf(KdbxOpenError);
		expect(error.reason).toBe("wrong-key");
		expect(error.message).toStartWith(
			"That password and key file don't open this database.",
		);
	});

	test("settings past the limits are refused before anything is derived", async () => {
		// Argon2's memory: "M", 8 bytes, in its VarDictionary entry.
		const marker = [0x05, 0x01, 0x00, 0x00, 0x00, 0x4d, 0x08, 0x00, 0x00, 0x00];
		const greedy = patched(
			fixture("kdbx/keepass.kdbx"),
			marker,
			4n * 1024n * 1024n * 1024n,
		);
		const error = await failure(openKdbx(greedy, "example-keepass-password"));
		expect(error.reason).toBe("too-costly");
		expect(error.message).toContain("4096 MiB of memory");

		// KDBX 3.1's TransformRounds: field 6, 8 bytes long.
		const slow = patched(
			fixture("kdbx/keepass-3.1.kdbx"),
			[0x06, 0x08, 0x00],
			10_000_000_000n,
		);
		expect((await failure(openKdbx(slow, "x"))).reason).toBe("too-costly");
	});

	test("something that isn't a database is turned away", async () => {
		const error = await failure(
			openKdbx(buffer(new TextEncoder().encode("not a database at all")), "x"),
		);
		expect(error.reason).toBe("not-kdbx");
	});

	test("settings past the limits are refused before the password is asked for", () => {
		const marker = [0x05, 0x01, 0x00, 0x00, 0x00, 0x4d, 0x08, 0x00, 0x00, 0x00];
		const greedy = new Uint8Array(
			patched(fixture("kdbx/keepass.kdbx"), marker, 4n * 1024n * 1024n * 1024n),
		);
		expect(() => readImport(greedy)).toThrow(ImportError);
		expect(() => readImport(greedy)).toThrow("4096 MiB of memory");
		const slow = new Uint8Array(
			patched(
				fixture("kdbx/keepass-3.1.kdbx"),
				[0x06, 0x08, 0x00],
				10_000_000_000n,
			),
		);
		expect(() => readImport(slow)).toThrow("10,000,000,000 AES-KDF rounds");
		// KeePass 1's .kdb starts the same way, then says so.
		const kdb = fixture("kdbx/keepass.kdbx").slice(0, 64);
		kdb.set([0x65, 0xfb, 0x4b, 0xb5], 4);
		expect(() => readImport(kdb)).toThrow("KeePass 1 database");
		// So does KDBX 2, from KeePass before 2.20, which kdbxweb doesn't read.
		const old = fixture("kdbx/keepass.kdbx").slice();
		old.set([0x04, 0x00, 0x02, 0x00], 8);
		expect(() => readImport(old)).toThrow("(KDBX 2)");
	});

	test("attachments come beside the XML, as files on their items", async () => {
		const { xml: text, files } = await openKdbx(
			file("attachments.kdbx"),
			"example-keepass-password",
		);
		// The entry's two. Not its earlier version's, nor the Recycle Bin's.
		expect(files.map(({ name, size }) => [name, size])).toEqual([
			["server.p12", 19],
			["recovery.txt", 22],
		]);
		expect(new TextDecoder().decode(files[0]?.data)).toBe(
			"example certificate",
		);
		expect(text).not.toContain("<Binary");
		const parsed = parseKeePassXml(
			text,
			new Map([
				[
					files[0]?.entry ?? "",
					files.map(({ name, size, data }) => ({
						name,
						size,
						data: data && new Uint8Array(data),
					})),
				],
			]),
		);
		expect(parsed.left).toEqual({ trashed: 1 });
		const github = parsed.items.find((item) => item.name === "GitHub");
		const attached = github && parsed.files?.get(github);
		expect(attached?.map((one) => one.name)).toEqual([
			"server.p12",
			"recovery.txt",
		]);
		expect(new TextDecoder().decode(attached?.[1]?.data)).toBe(
			"example recovery codes",
		);
	});

	test("an attachment over the file limit comes with its size, not its bytes", async () => {
		const { files } = await openKdbx(
			file("attachments.kdbx"),
			"example-keepass-password",
			undefined,
			20,
		);
		expect(files.map(({ name, size, data }) => [name, size, !!data])).toEqual([
			["server.p12", 19, true],
			["recovery.txt", 22, false],
		]);
	});

	test("a small file that unpacks past the limit is refused before it unpacks", async () => {
		for (const name of ["unpacks-big.kdbx", "unpacks-big-3.1.kdbx"]) {
			expect(fixture(`kdbx/${name}`).byteLength).toBeLessThan(1024 * 1024);
			const error = await failure(
				openKdbx(file(name), "example-keepass-password"),
			);
			expect(error.reason).toBe("too-costly");
			expect(error.message).toContain("more than 256 MB once it's unpacked");
		}
	});

	test("an attachment compressed inside the XML counts towards the limit too", () => {
		// What a GZIP stream says it unpacks to is all that's read before refusing.
		const stream = gzipSync(new TextEncoder().encode("small"));
		new DataView(stream.buffer).setUint32(
			stream.byteLength - 4,
			300 * 1024 * 1024,
			true,
		);
		const node = kdbxweb.XmlUtils.parse(
			`<Binary Compressed="True">${kdbxweb.ByteUtils.bytesToBase64(stream)}</Binary>`,
		).documentElement;
		kdbxweb.setInflateLimit(KDBX_LIMITS.unpacked);
		expect(() => kdbxweb.XmlUtils.getProtectedBinary(node)).toThrow(
			"InflateLimit",
		);
	});

	test("a key file can be any file, and a database may have no password", async () => {
		const result = parseImport(
			await xml(
				openKdbx(file("key-file-only.kdbx"), "", file("key-file-only.xml")),
			),
		);
		expect(result.items).toHaveLength(2);
	});

	test("an empty password can count, beside a version 2 key file without its check", async () => {
		const result = parseImport(
			await xml(
				openKdbx(file("empty-password.kdbx"), "", file("empty-password.keyx")),
			),
		);
		expect(result.items).toHaveLength(2);
	});

	test("key files are read as KeePass reads them", async () => {
		const hex = (key: ArrayBuffer) => kdbxweb.ByteUtils.bytesToHex(key);
		const key = "0123456789abcdef".repeat(4);
		const text = (value: string) => buffer(new TextEncoder().encode(value));
		const v2 = (hash?: string) =>
			text(
				`<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data${hash ? ` Hash="${hash}"` : ""}>${key}</Data></Key></KeyFile>`,
			);
		const digest = hex(
			await crypto.subtle.digest(
				"SHA-256",
				buffer(kdbxweb.ByteUtils.hexToBytes(key)),
			),
		);
		expect(hex(await keyFileKey(v2()))).toBe(key);
		expect(hex(await keyFileKey(v2(digest.slice(0, 8).toUpperCase())))).toBe(
			key,
		);
		expect((await failure(keyFileKey(v2("DEADBEEF")))).message).toContain(
			"key file is damaged",
		);
		// Version 1: the key as base64.
		const raw = kdbxweb.ByteUtils.hexToBytes(key);
		expect(
			hex(
				await keyFileKey(
					text(
						`<KeyFile><Meta><Version>1.00</Version></Meta><Key><Data>${kdbxweb.ByteUtils.bytesToBase64(raw)}</Data></Key></KeyFile>`,
					),
				),
			),
		).toBe(key);
		// 32 bytes as they are, 64 hex characters, and anything else hashed.
		expect(hex(await keyFileKey(buffer(raw)))).toBe(key);
		expect(hex(await keyFileKey(text(key)))).toBe(key);
		const other = text("<notes>not a key file</notes>");
		expect(hex(await keyFileKey(other))).toBe(
			hex(await crypto.subtle.digest("SHA-256", other)),
		);
		const huge = new ArrayBuffer(KDBX_LIMITS.keyFileSize + 1);
		expect((await failure(keyFileKey(huge))).reason).toBe("too-costly");
	});
});
