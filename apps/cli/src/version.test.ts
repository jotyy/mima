import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { commit, version, versionLine } from "./version";

test("run from source, the CLI says it's a development copy", () => {
	expect(version).toMatch(/^\d+\.\d+\.\d+-dev$/);
	expect(commit).toBeNull();
	expect(versionLine).toBe(`vauly ${version}`);
});

test("vauly --version prints the version line", () => {
	const result = spawnSync("bun", ["src/index.ts", "--version"], {
		cwd: `${import.meta.dir}/..`,
		encoding: "utf8",
	});
	expect(result.status).toBe(0);
	expect(result.stdout.trim()).toBe(versionLine);
});
