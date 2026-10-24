import { describe, expect, test } from "bun:test";
import { argon2idLanes } from "@vauly/crypto/argon2-lanes";
import { zipSync } from "fflate";
import * as openpgp from "openpgp";

import { fixture, fixtureText } from "./fixtures";
import { PASSWORD } from "./fixtures/make-protected";
import {
	ImportError,
	LockedExport,
	parseImport,
	readImport,
	WrongPasswordError,
} from "./index";

// Exports protected with a password, made with each app's own crypto
// (fixtures/make-protected.ts): Bitwarden's SDK and OpenPGP.js as Proton Pass calls it.

/** What the import dialog does: find the lock, then open it with the password. */
async function unlock(bytes: Uint8Array, password: string) {
	let locked: LockedExport | undefined;
	try {
		readImport(bytes);
	} catch (error) {
		if (error instanceof LockedExport) locked = error;
		else throw error;
	}
	if (!locked) throw new Error("Not locked");
	return {
		app: locked.app,
		parsed: await locked.open(password, argon2idLanes),
	};
}

const items = (text: string) => parseImport(text).items;

describe("Bitwarden's password-protected export", () => {
	for (const kdf of ["pbkdf2", "argon2id"]) {
		test(`opens with the file password (${kdf})`, async () => {
			const { app, parsed } = await unlock(
				fixture(`bitwarden-protected-${kdf}.json`),
				PASSWORD,
			);
			expect(app).toBe("Bitwarden");
			expect(parsed.source).toBe("Bitwarden");
			expect(parsed.items).toEqual(items(fixtureText("bitwarden.json")));
		});

		test(`a wrong password says so (${kdf})`, async () => {
			await expect(
				unlock(fixture(`bitwarden-protected-${kdf}.json`), "not the password"),
			).rejects.toBeInstanceOf(WrongPasswordError);
			await expect(
				unlock(fixture(`bitwarden-protected-${kdf}.json`), ""),
			).rejects.toBeInstanceOf(WrongPasswordError);
		});
	}

	test("refuses key settings Bitwarden itself doesn't use, before asking for the password", () => {
		const argon2 = JSON.parse(fixtureText("bitwarden-protected-argon2id.json"));
		const pbkdf2 = JSON.parse(fixtureText("bitwarden-protected-pbkdf2.json"));
		for (const file of [
			{ ...argon2, kdfMemory: 1025 },
			{ ...argon2, kdfMemory: 15 },
			{ ...argon2, kdfParallelism: 17 },
			{ ...argon2, kdfIterations: 11 },
			{ ...argon2, kdfMemory: undefined },
			{ ...pbkdf2, kdfIterations: 4_999 },
			{ ...pbkdf2, kdfIterations: 2_000_001 },
			{ ...pbkdf2, kdfIterations: 600_000.5 },
			{ ...pbkdf2, kdfType: 2 },
		])
			expect(() =>
				readImport(new TextEncoder().encode(JSON.stringify(file))),
			).toThrow("key settings Bitwarden itself doesn't use");
	});

	test("refuses a file whose salt or encrypted parts aren't Bitwarden's, before asking", () => {
		const file = JSON.parse(fixtureText("bitwarden-protected-pbkdf2.json"));
		for (const broken of [
			{ ...file, salt: "" },
			{ ...file, salt: "x".repeat(65) },
			{ ...file, data: "0.not|an|encstring" },
			{ ...file, encKeyValidation_DO_NOT_EDIT: "2.only|two" },
		])
			expect(() =>
				readImport(new TextEncoder().encode(JSON.stringify(broken))),
			).toThrow("isn't one vauly can read");
	});

	test("a password of only spaces is a wrong one", async () => {
		await expect(
			unlock(fixture("bitwarden-protected-pbkdf2.json"), "   "),
		).rejects.toBeInstanceOf(WrongPasswordError);
	});

	test("refuses a file changed after it was exported", async () => {
		const file = JSON.parse(fixtureText("bitwarden-protected-pbkdf2.json"));
		const [iv, data, mac] = file.data.slice(2).split("|");
		const flipped = Buffer.from(data, "base64");
		flipped[0] = (flipped[0] ?? 0) ^ 1;
		file.data = `2.${iv}|${flipped.toString("base64")}|${mac}`;
		await expect(
			unlock(new TextEncoder().encode(JSON.stringify(file)), PASSWORD),
		).rejects.toThrow("changed after it was exported");
	});

	test("an account-restricted export says only Bitwarden can open it", () => {
		expect(() =>
			parseImport(
				JSON.stringify({
					encrypted: true,
					encKeyValidation_DO_NOT_EDIT: "2.AAAA|AAAA|AAAA",
					items: [],
				}),
			),
		).toThrow(ImportError);
		expect(() =>
			parseImport(JSON.stringify({ encrypted: true, items: [] })),
		).toThrow("account restricted");
	});
});

describe("Proton Pass's PGP-encrypted export", () => {
	const plain = () => items(fixtureText("proton-pass.json"));

	test("today's ZIP, with data.pgp in it", async () => {
		const zip = zipSync({
			"Proton Pass/data.pgp": fixture("proton-pass-data.pgp"),
		});
		const { app, parsed } = await unlock(zip, PASSWORD);
		expect(app).toBe("Proton Pass");
		expect(parsed.format).toBe("ZIP");
		expect(parsed.items).toEqual(plain());
	});

	test("data.pgp on its own", async () => {
		const { parsed } = await unlock(fixture("proton-pass-data.pgp"), PASSWORD);
		expect(parsed.items).toEqual(plain());
	});

	test("an older export: the whole ZIP encrypted", async () => {
		const { parsed } = await unlock(
			fixture("proton-pass-legacy.pgp"),
			PASSWORD,
		);
		expect(parsed.items).toEqual(plain());
	});

	test("anything but one passphrase with an iterated S2K is refused, before it's tried", async () => {
		const data = new TextEncoder().encode('{"vaults":{}}');
		const encrypted = async (
			options: Partial<Parameters<typeof openpgp.encrypt>[0]>,
		) =>
			openpgp.encrypt({
				message: await openpgp.createMessage({ binary: data }),
				format: "armored",
				...options,
			} as Parameters<typeof openpgp.encrypt>[0]);
		for (const file of [
			// Two passphrases: OpenPGP.js would hash for both at once.
			await encrypted({ passwords: [PASSWORD, "another one"] }),
			// Argon2 instead of Proton's iterated S2K.
			await encrypted({
				passwords: [PASSWORD],
				config: { s2kType: openpgp.enums.s2k.argon2 },
			}),
		]) {
			await expect(
				unlock(new TextEncoder().encode(String(file)), PASSWORD),
			).rejects.toThrow("isn't a Proton Pass export vauly can open");
		}
	});

	test("a passphrase of only spaces is a wrong one", async () => {
		await expect(
			unlock(fixture("proton-pass-data.pgp"), "  "),
		).rejects.toBeInstanceOf(WrongPasswordError);
	});

	test("a wrong passphrase says so", async () => {
		await expect(
			unlock(fixture("proton-pass-data.pgp"), "not the passphrase"),
		).rejects.toBeInstanceOf(WrongPasswordError);
	});
});
