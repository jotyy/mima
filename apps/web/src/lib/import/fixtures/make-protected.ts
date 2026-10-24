/// <reference types="bun" />

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { strToU8, zipSync } from "fflate";
import * as openpgp from "openpgp";

// Makes the password-protected fixtures, each with the app's own crypto, so the tests
// check vauly's reader against that app rather than against itself:
// - Bitwarden's with its SDK (@bitwarden/sdk-internal's PureCrypto), the way
//   BaseVaultExportService.buildPasswordExport does in bitwarden/clients;
// - Proton Pass's with OpenPGP.js, the way encryptPassExport does in ProtonMail/WebClients.
//
// The SDK isn't a dependency of vauly. To make the fixtures again:
//   npm pack @bitwarden/sdk-internal@0.2.0-main.1157 && tar -xzf bitwarden-sdk-internal-*.tgz
//   bun src/lib/import/fixtures/make-protected.ts <that>/package/node/bitwarden_wasm_internal.js
// from apps/web. Every run makes new salts, keys and files.

export const PASSWORD = "correct horse battery staple";

type Kdf =
	| { pBKDF2: { iterations: number } }
	| { argon2id: { iterations: number; memory: number; parallelism: number } };

type PureCrypto = {
	derive_kdf_material(
		password: Uint8Array,
		salt: Uint8Array,
		kdf: Kdf,
	): Uint8Array;
	symmetric_encrypt_string(plain: string, key: Uint8Array): string;
	new_guid(): string;
};

/** HKDF-Expand alone, one block: what Bitwarden's stretchKey does with "enc" and "mac". */
function expand(key: Uint8Array, info: string) {
	return createHmac("sha256", key)
		.update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
		.digest();
}

function bitwarden(pure: PureCrypto, clearText: string, kdf: Kdf) {
	const salt = randomBytes(16).toString("base64");
	const material = pure.derive_kdf_material(
		new TextEncoder().encode(PASSWORD),
		new TextEncoder().encode(salt),
		kdf,
	);
	const key = new Uint8Array(
		Buffer.concat([expand(material, "enc"), expand(material, "mac")]),
	);
	const file: Record<string, unknown> = {
		encrypted: true,
		passwordProtected: true,
		salt,
		kdfType: "argon2id" in kdf ? 1 : 0,
		kdfIterations:
			"argon2id" in kdf ? kdf.argon2id.iterations : kdf.pBKDF2.iterations,
		encKeyValidation_DO_NOT_EDIT: pure.symmetric_encrypt_string(
			pure.new_guid(),
			key,
		),
		data: pure.symmetric_encrypt_string(clearText, key),
	};
	if ("argon2id" in kdf) {
		file.kdfMemory = kdf.argon2id.memory;
		file.kdfParallelism = kdf.argon2id.parallelism;
	}
	return JSON.stringify(file, null, "  ");
}

/** Proton Pass's encryptPassExport. */
async function proton(data: Uint8Array) {
	return openpgp.encrypt({
		message: await openpgp.createMessage({ binary: data }),
		passwords: [PASSWORD],
		config: { s2kIterationCountByte: 255 },
		format: "armored",
	});
}

if (import.meta.main) {
	const sdk = process.argv[2];
	if (!sdk)
		throw new Error(
			"Give the path to the SDK's node/bitwarden_wasm_internal.js",
		);
	const { PureCrypto } = createRequire(import.meta.url)(sdk) as {
		PureCrypto: PureCrypto;
	};
	const dir = import.meta.dir;
	const plain = readFileSync(`${dir}/bitwarden.json`, "utf8");
	writeFileSync(
		`${dir}/bitwarden-protected-pbkdf2.json`,
		bitwarden(PureCrypto, plain, { pBKDF2: { iterations: 600_000 } }),
	);
	writeFileSync(
		`${dir}/bitwarden-protected-argon2id.json`,
		bitwarden(PureCrypto, plain, {
			argon2id: { iterations: 3, memory: 64, parallelism: 4 },
		}),
	);

	const data = readFileSync(`${dir}/proton-pass.json`);
	// Today's export: a ZIP whose data.json is encrypted, as data.pgp.
	writeFileSync(`${dir}/proton-pass-data.pgp`, await proton(data));
	// Before that, the whole ZIP was encrypted.
	writeFileSync(
		`${dir}/proton-pass-legacy.pgp`,
		await proton(
			zipSync({ "Proton Pass/data.json": strToU8(data.toString()) }),
		),
	);
}
