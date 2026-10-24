import { describe, expect, test } from "bun:test";
import { argon2idLanes } from "@vauly/crypto/argon2-lanes";
import { zipSync } from "fflate";

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

	test("refuses key settings Bitwarden itself doesn't use, before deriving", async () => {
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
		]) {
			let derived = false;
			await expect(
				(async () => {
					try {
						readImport(new TextEncoder().encode(JSON.stringify(file)));
					} catch (error) {
						if (!(error instanceof LockedExport)) throw error;
						await error.open(PASSWORD, async () => {
							derived = true;
							return new Uint8Array(32);
						});
					}
				})(),
			).rejects.toThrow("key settings Bitwarden itself doesn't use");
			expect(derived).toBe(false);
		}
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

	test("a wrong passphrase says so", async () => {
		await expect(
			unlock(fixture("proton-pass-data.pgp"), "not the passphrase"),
		).rejects.toBeInstanceOf(WrongPasswordError);
	});
});
