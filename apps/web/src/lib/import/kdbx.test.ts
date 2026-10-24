/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import { LockedExport, parseImport, readImport } from ".";
import { fixture } from "./fixtures";
import { KdbxOpenError, openKdbx } from "./kdbx-open";

// KeePass databases opened in place of an XML export: written by fixtures/kdbx/make.ts
// with each app's settings, then read the way the import worker reads them.

const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;
const file = (name: string) => buffer(fixture(`kdbx/${name}`));

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
			await openKdbx(buffer(bytes), "example-keepass-password"),
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
			await openKdbx(
				file("keepassxc.kdbx"),
				"example-keepassxc-password",
				keyFile,
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
			await openKdbx(file("keepass-3.1.kdbx"), "example-kdbx3-password"),
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
});
