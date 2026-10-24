import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

import {
	capture,
	type ItemFields,
	prepareEnv,
	safeFileName,
	withValues,
	writeFiles,
} from "./agent";
import { findReferences } from "./references";

const item: ItemFields = {
	name: "Bank",
	secret: "example-password",
	username: "alex",
	fields: [
		{ label: "Account number", value: "12345678" },
		{ label: "PIN", value: "4711", hidden: true },
	],
};

describe("withValues", () => {
	test("puts custom fields in the environment, masking only hidden ones", () => {
		const env = {
			ACCOUNT: "vauly://itm_bank/fields/account%20NUMBER",
			PIN: "vauly://itm_bank/fields/PIN",
			PASSWORD: "vauly://itm_bank",
			VAULY_TOKEN: "vauly_agent_example",
		};
		const refs = findReferences(env);
		const { env: filled, secrets } = withValues(
			env,
			refs,
			new Map([["itm_bank", item]]),
		);
		expect(filled.ACCOUNT).toBe("12345678");
		expect(filled.PIN).toBe("4711");
		expect(filled.PASSWORD).toBe("example-password");
		expect(filled.VAULY_TOKEN).toBeUndefined();
		expect(secrets.sort()).toEqual(["4711", "example-password"]);
	});

	test("says which field is missing", () => {
		const env = { X: "vauly://itm_bank/fields/Security%20answer" };
		expect(() =>
			withValues(env, findReferences(env), new Map([["itm_bank", item]])),
		).toThrow("Bank has no field called Security answer.");
	});
});

describe("files", () => {
	const values = new Map([
		[
			"itm_abc123",
			{
				name: "Deploy",
				files: [{ name: "server.p12", data: new Uint8Array([1, 2, 3]) }],
			},
		],
	]);

	test("a file goes to the command as a path only its user can read", () => {
		const refs = [
			{
				name: "CERT",
				itemId: "itm_abc123",
				field: "file" as const,
				label: "Server.P12",
			},
		];
		const { paths, cleanup } = writeFiles(refs, values);
		const path = paths.get("CERT") ?? "";
		expect(path.endsWith("/server.p12")).toBe(true);
		expect([...readFileSync(path)]).toEqual([1, 2, 3]);
		expect(statSync(path).mode & 0o777).toBe(0o600);
		const { env } = withValues(
			{ CERT: "vauly://itm_abc123/files/server.p12" },
			refs,
			values,
			paths,
		);
		expect(env.CERT).toBe(path);
		cleanup();
		expect(existsSync(path)).toBe(false);
	});

	test("a name the item doesn't have is an error, and nothing stays behind", () => {
		expect(() =>
			writeFiles(
				[
					{
						name: "KEY",
						itemId: "itm_abc123",
						field: "file",
						label: "missing.pem",
					},
				],
				values,
			),
		).toThrow("Deploy has no file called missing.pem.");
	});
});

describe("files on disk", () => {
	const values = new Map([
		[
			"itm_abc123",
			{
				name: "Deploy",
				files: [{ name: "server.p12", data: new Uint8Array([1, 2, 3]) }],
			},
		],
	]);
	const ours = () =>
		readdirSync(tmpdir())
			.filter((name) => name.startsWith("vauly-"))
			.sort();

	test("nothing stays behind when the environment can't be made", () => {
		const before = ours();
		expect(() =>
			prepareEnv(
				{},
				[
					{
						name: "CERT",
						itemId: "itm_abc123",
						field: "file",
						label: "server.p12",
					},
					// A field the item doesn't have: withValues throws after the file is written.
					{
						name: "PIN",
						itemId: "itm_abc123",
						field: "custom",
						label: "PIN",
					},
				],
				values,
			),
		).toThrow("Deploy has no field called PIN.");
		expect(ours()).toEqual(before);
	});

	test("hostile names can't become paths, streams or devices", () => {
		expect(safeFileName("../../etc/passwd")).toBe("__.._etc_passwd");
		expect(safeFileName("a:b.txt")).toBe("a_b.txt");
		expect(safeFileName("CON")).toBe("_CON");
		expect(safeFileName("nul.txt")).toBe("_nul.txt");
		expect(safeFileName("com1.pem")).toBe("_com1.pem");
		expect(safeFileName("COM¹.txt")).toBe("_COM¹.txt");
		expect(safeFileName("lpt³")).toBe("_lpt³");
		expect(safeFileName("notes. . ")).toBe("notes");
		expect(safeFileName("...")).toBe("file");
		expect(safeFileName("server.p12")).toBe("server.p12");
		expect(safeFileName("con-notes.txt")).toBe("con-notes.txt");
	});
});

describe("capture", () => {
	const run = (command: string, timeoutMs: number, onExit?: () => void) =>
		capture(command, {
			env: process.env,
			secrets: [],
			cwd: tmpdir(),
			timeoutMs,
			limit: 10_000,
			onExit,
			killGraceMs: 200,
		});

	test("a command that ignores being asked to stop is stopped anyway", async () => {
		let exited = false;
		const result = await run("trap '' TERM; sleep 30", 200, () => {
			exited = true;
		});
		expect(result.timedOut).toBe(true);
		expect(exited).toBe(true);
	});

	test("a child left holding the output doesn't keep it waiting", async () => {
		const started = Date.now();
		const result = await run("sleep 30 & echo done", 10_000);
		expect(result.stdout).toContain("done");
		expect(Date.now() - started).toBeLessThan(4_000);
	});
});
