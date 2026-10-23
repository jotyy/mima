#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Builds the CLI for a release: one binary per platform, named the way install.sh asks
// for them, with the version and commit built in.
//
//   bun scripts/release.ts build [--version 0.1.0] [--commit abc1234] [platform...]
//   bun scripts/release.ts checksums      writes dist/SHA256SUMS for what's in dist/
//
// Without platforms it builds all of them. Bun builds every platform from any host.

// x64 builds are Bun's baseline ones, which don't need AVX2: older machines, some virtual
// machines and Rosetta lack it, and a CLI doesn't need the speed.
export const platforms = {
	"darwin-arm64": "bun-darwin-arm64",
	"darwin-x64": "bun-darwin-x64-baseline",
	"linux-arm64": "bun-linux-arm64",
	"linux-x64": "bun-linux-x64-baseline",
	"windows-x64": "bun-windows-x64-baseline",
} as const;

type Platform = keyof typeof platforms;

const root = join(import.meta.dir, "..");
const dist = join(root, "dist");

export const binaryName = (platform: Platform) =>
	`vauly-${platform}${platform.startsWith("windows") ? ".exe" : ""}`;

function option(args: string[], name: string) {
	const at = args.indexOf(name);
	if (at === -1) return undefined;
	const [value] = args.splice(at, 2).slice(1);
	return value;
}

function build(args: string[]) {
	const version = option(args, "--version");
	const commit = option(args, "--commit");
	const chosen = (args.length ? args : Object.keys(platforms)) as Platform[];
	mkdirSync(dist, { recursive: true });
	for (const platform of chosen) {
		const target = platforms[platform];
		if (!target) throw new Error(`Unknown platform ${platform}.`);
		const outfile = join(dist, binaryName(platform));
		const result = spawnSync(
			"bun",
			[
				"build",
				"--compile",
				"--minify",
				`--target=${target}`,
				...(version
					? ["--define", `VAULY_VERSION=${JSON.stringify(version)}`]
					: []),
				...(commit
					? ["--define", `VAULY_COMMIT=${JSON.stringify(commit)}`]
					: []),
				"src/index.ts",
				"--outfile",
				outfile,
			],
			{ cwd: root, stdio: "inherit" },
		);
		if (result.status !== 0) process.exit(result.status ?? 1);
		console.log(`built ${binaryName(platform)}`);
	}
}

/** The same format as `sha256sum`, so `sha256sum -c` and `shasum -a 256 -c` read it. */
function checksums() {
	const lines = readdirSync(dist)
		.filter((name) => name.startsWith("vauly-"))
		.sort()
		.map((name) => {
			const hash = createHash("sha256")
				.update(readFileSync(join(dist, name)))
				.digest("hex");
			return `${hash}  ${name}`;
		});
	if (lines.length === 0) throw new Error("Nothing in dist/ to sum up.");
	writeFileSync(join(dist, "SHA256SUMS"), `${lines.join("\n")}\n`);
	console.log(lines.join("\n"));
}

if (import.meta.main) {
	const [command, ...args] = process.argv.slice(2);
	if (command === "build") build(args);
	else if (command === "checksums") checksums();
	else {
		console.error("Usage: bun scripts/release.ts build|checksums");
		process.exit(1);
	}
}
