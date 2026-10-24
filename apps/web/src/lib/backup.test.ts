import { describe, expect, test } from "bun:test";
import { toBase64 } from "@vauly/crypto";
import { argon2idLanes } from "@vauly/crypto/argon2-lanes";
import { strToU8, unzipSync, zipSync } from "fflate";

import {
	type BackupRow,
	backupFilePath,
	toBackupJson,
	toSealedBackupZip,
} from "./backup";
import {
	ImportError,
	LockedExport,
	parseImport,
	readImport,
	WrongPasswordError,
} from "./import";
import { sealBackup, sealFiles } from "./import/protected";

// A protected backup: Bitwarden's password-protected export of Bitwarden's JSON, each
// item with vauly's own copy. vauly's import must bring back exactly what went in.

const PASSWORD = "maple orbit lantern quiet harbor seven";

const items: BackupRow[] = [
	{
		vault: "Engineering",
		favorite: true,
		kind: "login",
		name: "GitHub, main",
		username: "alex@example.test",
		secret: 'example "quoted" pass',
		url: "https://github.com",
		moreUrls: ["https://gist.github.com"],
		totp: "JBSWY3DPEHPK3PXP",
		tags: ["work", "code"],
		fields: [
			{ label: "Account ID", value: "12345" },
			{ label: "Recovery PIN", value: "4711", hidden: true },
		],
		history: [
			{ secret: "example-older-pass", until: "2026-09-01T10:00:00.000Z" },
		],
	},
	{
		vault: "Engineering",
		kind: "ssh-key",
		name: "deploy@prod",
		secret:
			"-----BEGIN EXAMPLE KEY-----\nnot-a-real-key\n-----END EXAMPLE KEY-----",
	},
	{
		vault: "Engineering",
		kind: "api-key",
		name: "Stripe",
		secret: "sk_example_1",
	},
	{
		vault: "Private",
		kind: "note",
		name: "Door codes",
		notes: "Front: example-0000",
	},
	{
		vault: "Engineering",
		kind: "card",
		name: "Company Visa",
		card: {
			cardholder: "Alex Example",
			number: "4111111111111111",
			expiry: "06/2030",
			code: "123",
			pin: "0000",
		},
	},
	{
		vault: "Engineering",
		kind: "identity",
		name: "Acme Ltd",
		identity: {
			name: "Alex Example",
			company: "Acme Ltd",
			email: "billing@acme.test",
			address: "1 Example Street\nUnit 2",
			city: "Springfield",
			postalCode: "00000",
			country: "US",
			taxNumber: "00-0000000",
			registrationNumber: "HRB 00000",
		},
	},
];

/** The lock on a protected backup, ZIP or not. */
function lockOf(bytes: Uint8Array) {
	try {
		readImport(bytes);
	} catch (error) {
		if (error instanceof LockedExport) return error;
		throw error;
	}
	throw new Error("Not locked");
}

const open = (file: string, password: string) =>
	lockOf(new TextEncoder().encode(file)).open(password, {
		argon2: argon2idLanes,
	});

describe("a protected backup", () => {
	test("vauly's import brings back exactly what went in", async () => {
		const file = await sealBackup(toBackupJson(items), PASSWORD, argon2idLanes);
		const result = await open(file, PASSWORD);
		expect(result.source).toBe("vauly");
		expect(result.left).toEqual({});
		expect(result.items).toEqual(
			items.map(({ vault: _, favorite: __, ...fields }) => fields),
		);
	});

	test("is Bitwarden's password-protected format, with vauly's key settings", async () => {
		const file = JSON.parse(
			await sealBackup(toBackupJson(items), PASSWORD, argon2idLanes),
		);
		expect(file).toMatchObject({
			encrypted: true,
			passwordProtected: true,
			vauly: 1,
			kdfType: 1,
			kdfIterations: 3,
			kdfMemory: 64,
			kdfParallelism: 1,
		});
		expect(atob(file.salt)).toHaveLength(16);
		expect(file.encKeyValidation_DO_NOT_EDIT).toMatch(
			/^2\.[\w+/=]+\|[\w+/=]+\|[\w+/=]+$/,
		);
		await expect(open(JSON.stringify(file), "not it")).rejects.toBeInstanceOf(
			WrongPasswordError,
		);
	});

	test("a big vault seals too", async () => {
		const many: BackupRow[] = Array.from({ length: 4000 }, (_, index) => ({
			vault: "Engineering",
			kind: "note",
			name: `Note ${index}`,
			notes: "example ".repeat(60),
		}));
		const file = await sealBackup(toBackupJson(many), PASSWORD, argon2idLanes);
		expect((await open(file, PASSWORD)).items).toHaveLength(4000);
	});

	const contract = new TextEncoder().encode("%PDF made-up contract");
	const key = new Uint8Array([1, 2, 3, 250]);

	/** A protected backup of one item with two files, as Settings makes it. */
	async function withFiles(first: Uint8Array = contract) {
		const rows: BackupRow[] = [
			{
				...(items[0] as BackupRow),
				files: [
					backupFilePath(1, "Contract.pdf"),
					backupFilePath(2, "id_ed25519"),
				],
			},
		];
		const sealed = await sealFiles(
			new Map([
				["files/1", first],
				["files/2", key],
			]),
		);
		return toSealedBackupZip(
			"vauly-backup-2026-10-24.json",
			await sealBackup(
				toBackupJson(rows, sealed.about),
				PASSWORD,
				argon2idLanes,
			),
			sealed.files,
		);
	}

	/** The backup's entries, its export first. */
	function entriesOf(zip: Uint8Array) {
		const entries = unzipSync(zip);
		const name =
			Object.keys(entries).find((entry) => entry.endsWith(".json")) ?? "";
		return { name, entries };
	}

	test("with files: a ZIP whose files are sealed and named only inside", async () => {
		const zip = await withFiles();
		expect(new TextDecoder("latin1").decode(zip)).not.toContain("Contract");
		const locked = lockOf(zip);
		expect(locked.app).toBe("vauly");
		const result = await locked.open(PASSWORD, { argon2: argon2idLanes });
		const files = [...(result?.files?.values() ?? [])].flat();
		expect(files.map((file) => file.name)).toEqual([
			"Contract.pdf",
			"id_ed25519",
		]);
		expect(files.map((file) => [...(file.data ?? [])])).toEqual([
			[...contract],
			[...key],
		]);
	});

	test("refuses a ZIP whose files were swapped, left out or resized", async () => {
		const { name, entries } = entriesOf(await withFiles());
		const { [name]: file, "files/1": one, "files/2": two } = entries;
		if (!file || !one || !two) throw new Error("Not a backup");
		const longer = new Uint8Array(one.length + 16);
		longer.set(one);
		for (const changed of [
			{ [name]: file, "files/1": two, "files/2": one },
			{ [name]: file, "files/1": one },
			{ [name]: file, "files/1": longer, "files/2": two },
		])
			await expect(
				lockOf(zipSync(changed)).open(PASSWORD, { argon2: argon2idLanes }),
			).rejects.toThrow("changed after it was made");
	});

	test("a file can't pass for the export, whatever it holds", async () => {
		// An attachment someone else could have written: an export of their own.
		const planted = strToU8(
			JSON.stringify({
				encrypted: false,
				vauly: 1,
				folders: [],
				items: [{ name: "Bank", vauly: { kind: "login", name: "Bank" } }],
			}),
		);
		const { name, entries } = entriesOf(await withFiles(planted));
		const root = JSON.parse(new TextDecoder().decode(entries[name]));
		const sealed = entries["files/1"] as Uint8Array;
		root.data = `2.${toBase64(sealed.slice(1, 17))}|${toBase64(sealed.slice(49))}|${toBase64(sealed.slice(17, 49))}`;
		await expect(
			lockOf(zipSync({ [name]: strToU8(JSON.stringify(root)) })).open(
				PASSWORD,
				{ argon2: argon2idLanes },
			),
		).rejects.toThrow("changed after it was exported");
	});

	test("only the files the export lists are unpacked", async () => {
		const { entries } = entriesOf(await withFiles());
		// An entry the export doesn't list, whose data would fail to inflate.
		const extra = "files/999";
		const zip = zipSync({
			...entries,
			[extra]: [new Uint8Array(4096), { level: 9 }],
		});
		const at = new TextDecoder("latin1").decode(zip).indexOf(extra);
		const padding = (zip[at - 2] ?? 0) | ((zip[at - 1] ?? 0) << 8);
		zip[at + extra.length + padding] = 0b111;
		expect(() => unzipSync(zip)).toThrow();
		const result = await lockOf(zip).open(PASSWORD, { argon2: argon2idLanes });
		expect([...(result.files?.values() ?? [])].flat()).toHaveLength(2);
	});

	test("a backup that isn't an object is refused", () => {
		for (const text of ["null", "[]", "7"])
			expect(() =>
				readImport(zipSync({ "vauly-backup-2026-10-24.json": strToU8(text) })),
			).toThrow(ImportError);
	});

	test("who changed a password stays behind", async () => {
		const file = await sealBackup(
			toBackupJson([
				{
					vault: "Engineering",
					kind: "login",
					name: "Wiki",
					secret: "example-now",
					history: [
						{
							secret: "example-then",
							until: "2026-09-01T10:00:00.000Z",
							by: "Sam Example",
						},
					],
				},
			]),
			PASSWORD,
			argon2idLanes,
		);
		const [item] = (await open(file, PASSWORD)).items;
		expect(item?.history).toEqual([
			{ secret: "example-then", until: "2026-09-01T10:00:00.000Z" },
		]);
	});

	test("other apps read it as Bitwarden's JSON", () => {
		// Without vauly's copies, which only vauly reads: what Bitwarden itself gets.
		const json = JSON.parse(toBackupJson(items));
		delete json.vauly;
		for (const item of json.items) delete item.vauly;
		const result = parseImport(JSON.stringify(json));
		expect(result.source).toBe("Bitwarden");
		const byName = Object.fromEntries(
			result.items.map((item) => [item.name, item]),
		);
		expect(byName["GitHub, main"]).toMatchObject({
			kind: "login",
			username: "alex@example.test",
			secret: 'example "quoted" pass',
			url: "https://github.com",
			moreUrls: ["https://gist.github.com"],
			totp: "JBSWY3DPEHPK3PXP",
		});
		expect(byName["Company Visa"]?.card).toMatchObject({
			cardholder: "Alex Example",
			number: "4111111111111111",
			expiry: "06/2030",
			code: "123",
		});
		expect(byName["Acme Ltd"]?.identity).toMatchObject({
			name: "Alex Example",
			company: "Acme Ltd",
			taxNumber: "00-0000000",
		});
		expect(byName["deploy@prod"]?.kind).toBe("ssh-key");
		expect(byName.Stripe?.secret).toBe("sk_example_1");
		expect(byName["Door codes"]?.kind).toBe("note");
	});
});
