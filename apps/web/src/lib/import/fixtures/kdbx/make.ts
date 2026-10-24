// Writes the KeePass databases the tests open, with kdbxweb and hash-wasm, the settings
// each app saves with, and made-up contents. Memory is kept small so the tests stay fast.
// Name files to write only those; with none, it writes them all.
//
//   bun apps/web/src/lib/import/fixtures/kdbx/make.ts [keepass.kdbx …]

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
const buffer = (data: Uint8Array) => new Uint8Array(data).buffer;
const wanted = process.argv.slice(2);

async function make(
	file: string,
	options: {
		generator: string;
		version: 3 | 4;
		kdf?: string;
		memoryKiB?: number;
		passes?: number;
		/** null: no password at all, as a database with only a key file has. */
		password: string | null;
		/** A key file kdbxweb reads, or the 32 bytes one stands for. */
		keyFile?: Uint8Array | ArrayBuffer;
		otp: [string, string];
		/** Attachments: on the GitHub entry, and on its earlier version only. */
		attachments?: Record<string, Uint8Array>;
		earlierAttachment?: Uint8Array;
	},
) {
	if (wanted.length > 0 && !wanted.includes(file)) return;
	const credentials = new kdbxweb.KdbxCredentials(
		options.password === null ? null : protect(options.password),
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
			new kdbxweb.Int64(options.passes ?? 2),
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
	for (const [name, data] of Object.entries(options.attachments ?? {})) {
		github.binaries.set(name, await db.createBinary(buffer(data)));
	}
	if (options.earlierAttachment) {
		github.binaries.set(
			"old.p12",
			await db.createBinary(buffer(options.earlierAttachment)),
		);
	}
	github.pushHistory();
	github.binaries.delete("old.p12");
	github.fields.set("Password", protect("example-kdbx-pass-2"));
	const note = db.createEntry(root);
	note.fields.set("Title", "Door codes");
	note.fields.set("Notes", "Front: example-0000");
	db.createRecycleBin();
	const bin = db.meta.recycleBinUuid;
	const gone = db.createEntry((bin && db.getGroup(bin)) || root);
	gone.fields.set("Title", "Old router");
	gone.fields.set("Password", protect("example-old"));
	if (options.attachments) {
		gone.binaries.set(
			"router.cfg",
			await db.createBinary(buffer(new TextEncoder().encode("example config"))),
		);
	}

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
if (wanted.length === 0 || wanted.includes("keepassxc.kdbx")) {
	writeFileSync(path.join(here, "keepassxc.keyx"), keyFile);
}
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

const bytes = (text: string) => new TextEncoder().encode(text);
const sha256 = (data: Uint8Array) =>
	crypto.subtle.digest("SHA-256", new Uint8Array(data));

// Attachments: two on the entry, one more on its earlier version, and one in the Recycle
// Bin. The import counts the entry's two as left behind.
await make("attachments.kdbx", {
	generator: "KeePass",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2d,
	memoryKiB: 1024,
	password: "example-keepass-password",
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
	attachments: {
		"server.p12": bytes("example certificate"),
		"recovery.txt": bytes("example recovery codes"),
	},
	earlierAttachment: bytes("example old certificate"),
});

// Small files that unpack past 256 MiB: an attachment of zeros, which KDBX 4 keeps in
// its inner header and KDBX 3.1 in its XML as base64.
for (const version of [4, 3] as const) {
	await make(version === 4 ? "unpacks-big.kdbx" : "unpacks-big-3.1.kdbx", {
		generator: "KeePass",
		version,
		kdf: version === 4 ? kdbxweb.Consts.KdfId.Argon2d : undefined,
		memoryKiB: 1024,
		password: "example-keepass-password",
		otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
		attachments: { "disk.img": new Uint8Array(300 * 1024 * 1024) },
	});
}

// A key file and no password, as KeePassXC makes one, where the key file is any file at
// all: here an XML file that isn't a key file, which KeePass hashes whole.
const anyFile = bytes(
	'<?xml version="1.0"?>\n<settings><theme>dark</theme></settings>\n',
);
if (wanted.length === 0 || wanted.includes("key-file-only.kdbx")) {
	writeFileSync(path.join(here, "key-file-only.xml"), anyFile);
}
await make("key-file-only.kdbx", {
	generator: "KeePassXC",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2id,
	memoryKiB: 1024,
	password: null,
	keyFile: await sha256(anyFile),
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
});

// An empty password that counts, as KeePass 2 makes one with its box ticked, and a
// version 2 key file without the check KeePass writes.
const keyHex = "0123456789abcdef".repeat(4);
if (wanted.length === 0 || wanted.includes("empty-password.kdbx")) {
	writeFileSync(
		path.join(here, "empty-password.keyx"),
		`<?xml version="1.0" encoding="utf-8"?>
<KeyFile>
	<Meta>
		<Version>2.0</Version>
	</Meta>
	<Key>
		<Data>
			${keyHex.slice(0, 32).toUpperCase()}
			${keyHex.slice(32).toUpperCase()}
		</Data>
	</Key>
</KeyFile>
`,
	);
}
await make("empty-password.kdbx", {
	generator: "KeePass",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2d,
	memoryKiB: 1024,
	password: "",
	keyFile: kdbxweb.ByteUtils.hexToBytes(keyHex),
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
});

// Slow to open, so the end-to-end test can cancel it while it does.
await make("slow.kdbx", {
	generator: "KeePass",
	version: 4,
	kdf: kdbxweb.Consts.KdfId.Argon2d,
	memoryKiB: 64 * 1024,
	passes: 100,
	password: "example-keepass-password",
	otp: ["TimeOtp-Secret-Base32", "JBSWY3DPEHPK3PXP"],
});
