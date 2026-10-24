// Writes the KeePass databases the tests open, with kdbxweb and hash-wasm, the settings
// each app saves with, and made-up contents. Memory is kept small so the tests stay fast.
//
//   bun apps/web/src/lib/import/fixtures/kdbx/make.ts

import { writeFileSync } from "node:fs";
import path from "node:path";
import { argon2d, argon2id } from "hash-wasm";
import * as kdbxweb from "kdbxweb";

kdbxweb.CryptoEngine.setArgon2Impl(
	async (password, salt, memory, iterations, length, parallelism, type) => {
		const options = {
			password: new Uint8Array(password),
			salt: new Uint8Array(salt),
			parallelism,
			iterations,
			memorySize: memory,
			hashLength: length,
			outputType: "binary" as const,
		};
		const hash =
			type === kdbxweb.CryptoEngine.Argon2TypeArgon2id
				? await argon2id(options)
				: await argon2d(options);
		return new Uint8Array(hash).buffer;
	},
);

const here = import.meta.dir;
const protect = (text: string) => kdbxweb.ProtectedValue.fromString(text);

async function make(
	file: string,
	options: {
		generator: string;
		version: 3 | 4;
		kdf?: string;
		memoryKiB?: number;
		password: string;
		keyFile?: Uint8Array;
		otp: [string, string];
	},
) {
	const credentials = new kdbxweb.KdbxCredentials(
		protect(options.password),
		options.keyFile ?? null,
	);
	const db = kdbxweb.Kdbx.create(credentials, "Example");
	db.meta.generator = options.generator;
	db.header.setVersion(options.version);
	if (options.kdf) db.header.setKdf(options.kdf);
	const params = db.header.kdfParameters;
	if (params && options.memoryKiB) {
		params.set(
			"M",
			kdbxweb.VarDictionary.ValueType.UInt64,
			new kdbxweb.Int64(options.memoryKiB * 1024),
		);
		params.set(
			"I",
			kdbxweb.VarDictionary.ValueType.UInt64,
			new kdbxweb.Int64(2),
		);
		params.set("P", kdbxweb.VarDictionary.ValueType.UInt32, 2);
	}
	if (options.version === 3) db.header.keyEncryptionRounds = 6000;

	const root = db.getDefaultGroup();
	const work = db.createGroup(root, "Work");
	const github = db.createEntry(work);
	github.fields.set("Title", "GitHub");
	github.fields.set("UserName", "alex@example.test");
	github.fields.set("Password", protect("example-kdbx-pass-1"));
	github.fields.set("URL", "https://github.com");
	github.fields.set("Notes", "Recovery codes are in the safe.");
	github.fields.set("PIN", protect("example-4711"));
	github.fields.set(options.otp[0], options.otp[1]);
	github.pushHistory();
	github.fields.set("Password", protect("example-kdbx-pass-2"));
	const note = db.createEntry(root);
	note.fields.set("Title", "Door codes");
	note.fields.set("Notes", "Front: example-0000");
	db.createRecycleBin();
	const bin = db.meta.recycleBinUuid;
	const gone = db.createEntry((bin && db.getGroup(bin)) || root);
	gone.fields.set("Title", "Old router");
	gone.fields.set("Password", protect("example-old"));

	writeFileSync(path.join(here, file), new Uint8Array(await db.save()));
	console.log(`Wrote ${file}`);
}

await make("keepass.kdbx", {
	generator: "KeePass",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2d,
	memoryKiB: 1024,
	password: "example-keepass-password",
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
});

const keyFile = await kdbxweb.KdbxCredentials.createRandomKeyFile(2);
writeFileSync(path.join(here, "keepassxc.keyx"), keyFile);
await make("keepassxc.kdbx", {
	generator: "KeePassXC",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2id,
	memoryKiB: 8 * 1024,
	password: "example-keepassxc-password",
	keyFile,
	otp: [
		"otp",
		"otpauth://totp/GitHub:alex?secret=JBSWY3DPEHPK3PXP&period=30&digits=6",
	],
});

await make("keepass-3.1.kdbx", {
	generator: "KeePass",
	version: 3,
	password: "example-kdbx3-password",
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
});
