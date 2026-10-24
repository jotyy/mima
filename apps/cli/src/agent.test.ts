import { describe, expect, spyOn, test } from "bun:test";
import { ChildProcess, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	capture,
	clearStaleFolders,
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
		// The folder names the process it's for, so a sweep leaves it while that runs.
		const folder = join(path, "..", "..");
		expect(readFileSync(join(folder, "owner.pid"), "utf8")).toBe(
			String(process.pid),
		);
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

	describe("a later run's sweep", () => {
		const day = 24 * 60 * 60 * 1000;
		// Every folder here looks two days old to the sweep.
		const later = () => Date.now() + 2 * day;
		const folder = (root: string, name: string, owner?: number) => {
			const path = join(root, name);
			mkdirSync(join(path, "0"), { recursive: true });
			writeFileSync(join(path, "0", "server.p12"), "example");
			if (owner !== undefined)
				writeFileSync(join(path, "owner.pid"), `${owner}`);
			return path;
		};
		const scratch = () => mkdtempSync(join(tmpdir(), "sweep-test-"));
		// A process that has come and gone.
		const ended = () => spawnSync("true").pid;

		test("clears old folders whose process has ended, and only ours", () => {
			const root = scratch();
			const stale = folder(root, "vauly-stale", ended());
			const unowned = folder(root, "vauly-unowned");
			const fresh = folder(root, "vauly-fresh", ended());
			const other = folder(root, "other-stale", ended());
			clearStaleFolders(Date.now(), root);
			expect(existsSync(fresh)).toBe(true);
			clearStaleFolders(later(), root);
			expect(existsSync(stale)).toBe(false);
			expect(existsSync(unowned)).toBe(false);
			expect(existsSync(other)).toBe(true);
			rmSync(root, { recursive: true });
		});

		test("keeps a folder while the process that wrote it runs, however old", () => {
			const root = scratch();
			const running = folder(root, "vauly-running", process.pid);
			clearStaleFolders(later(), root);
			expect(existsSync(join(running, "0", "server.p12"))).toBe(true);
			rmSync(root, { recursive: true });
		});

		test("never follows a link, or takes a file for a folder", () => {
			const root = scratch();
			const target = folder(root, "elsewhere");
			symlinkSync(target, join(root, "vauly-link"));
			writeFileSync(join(root, "vauly-file"), "not a folder");
			clearStaleFolders(later(), root);
			expect(existsSync(join(target, "0", "server.p12"))).toBe(true);
			expect(existsSync(join(root, "vauly-link"))).toBe(true);
			expect(existsSync(join(root, "vauly-file"))).toBe(true);
			rmSync(root, { recursive: true });
		});

		test("one it can't remove doesn't stop the rest", () => {
			const root = scratch();
			const names = ["vauly-a", "vauly-b", "vauly-c"];
			for (const name of names) folder(root, name, ended());
			// Can't be listed, so can't be emptied: removing it fails.
			const locked = join(root, "vauly-b");
			chmodSync(locked, 0o000);
			clearStaleFolders(later(), root);
			chmodSync(locked, 0o700);
			expect(readdirSync(root)).toEqual(["vauly-b"]);
			rmSync(root, { recursive: true });
		});
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

	test("a command gone by the time it would be killed isn't sent a kill", async () => {
		const kill = spyOn(ChildProcess.prototype, "kill");
		try {
			// Stops when asked, but a child of its own holds the output open past the grace.
			const result = await run("trap 'exit 0' TERM; sleep 30 & wait", 200);
			expect(result.timedOut).toBe(true);
			// Its PID may belong to another process by then.
			expect(kill.mock.calls).toEqual([["SIGTERM"]]);
		} finally {
			kill.mockRestore();
		}
	});

	test("a child left holding the output doesn't keep it waiting", async () => {
		const started = Date.now();
		const result = await run("sleep 30 & echo done", 10_000);
		expect(result.stdout).toContain("done");
		expect(Date.now() - started).toBeLessThan(4_000);
	});
});
