import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// /.well-known/vauly-build.json: every file the build serves, with its SHA-256, and the
// commit it was built from, so anyone can check what an instance serves against a build
// of their own (vauly verify, docs/security.md). Files that hold the instance's own
// settings aren't code, so they're left out and checked another way.

export const MANIFEST_PATH = ".well-known/vauly-build.json";

/** The instance's settings, not its code: verify reads them, and checks _headers apart. */
export const UNHASHED = new Set([MANIFEST_PATH, "vauly.json", "_headers"]);

export type BuildManifest = {
	format: 1;
	version: string;
	commit: string;
	/** Built from a working tree with changes, so no one can build the same files. */
	dirty: boolean;
	config: Record<string, unknown>;
	/** The headers every page is served with, from _headers: the CSP among them. */
	headers: Record<string, string>;
	/** "/path" → hex SHA-256, for every served file but the unhashed ones. */
	files: Record<string, string>;
};

function git(args: string[]) {
	try {
		return execFileSync("git", args, { encoding: "utf8" }).trim();
	} catch {
		return "";
	}
}

/** The commit being built: from CI when it says, else from git. */
export function buildCommit() {
	return (
		process.env.GITHUB_SHA ||
		process.env.WORKERS_CI_COMMIT_SHA ||
		git(["rev-parse", "HEAD"])
	);
}

/**
 * The build's own idea of "now": the commit's time, so two builds of one commit agree
 * (SOURCE_DATE_EPOCH, as reproducible-builds.org has it, wins when set).
 */
export function buildDate() {
	const seconds =
		Number(process.env.SOURCE_DATE_EPOCH) ||
		Number(git(["log", "-1", "--format=%ct"]));
	return seconds ? new Date(seconds * 1000) : new Date();
}

function listFiles(dir: string, base = dir): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listFiles(full, base);
		return [path.relative(base, full).split(path.sep).join("/")];
	});
}

/** The headers _headers sets for every path ("/*"). */
export function parseHeaders(text: string) {
	const headers: Record<string, string> = {};
	for (const line of text.split("\n")) {
		const match = /^\s+([\w-]+):\s*(.*)$/.exec(line);
		if (match?.[1]) headers[match[1].toLowerCase()] = (match[2] ?? "").trim();
	}
	return headers;
}

export function buildManifest(
	outDir: string,
	config: Record<string, unknown>,
): BuildManifest {
	const files: Record<string, string> = {};
	for (const file of listFiles(outDir).sort()) {
		if (UNHASHED.has(file)) continue;
		files[`/${file}`] = createHash("sha256")
			.update(readFileSync(path.join(outDir, file)))
			.digest("hex");
	}
	return {
		format: 1,
		version: process.env.VAULY_VERSION || "dev",
		commit: buildCommit(),
		dirty: git(["status", "--porcelain", "--untracked-files=no"]) !== "",
		config,
		headers: parseHeaders(
			readFileSync(path.join(outDir, "_headers"), "utf8").toString(),
		),
		files,
	};
}
