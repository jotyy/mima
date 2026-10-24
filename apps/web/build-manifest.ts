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
	/** 2 since headers are per rule; 1 had only the "/*" rule's. */
	format: 2;
	version: string;
	commit: string;
	/** Built from a working tree with changes, so no one can build the same files. */
	dirty: boolean;
	config: Record<string, unknown>;
	/**
	 * For each rule in _headers ("/*", the key worker's folder), the headers a file under
	 * it is served with: the CSP among them.
	 */
	headers: Record<string, Record<string, string>>;
	/** "/path" → hex SHA-256, for every served file but the unhashed ones. */
	files: Record<string, string>;
	/**
	 * The runtime Vite ran in. The files depend on it: Vite copies one of its own
	 * functions into the app as `fn.toString()`, and Bun re-prints the source it loads,
	 * so the same commit builds differently under Node, or another Bun.
	 */
	toolchain: { bun?: string; node?: string };
};

export const toolchain = () =>
	process.versions.bun
		? { bun: process.versions.bun }
		: { node: process.versions.node };

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

/** Whether a _headers path pattern, where * stands for anything, covers a path. */
export const coversPath = (pattern: string, file: string) =>
	new RegExp(
		`^${pattern
			.split("*")
			.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
			.join(".*")}$`,
	).test(file);

/**
 * The headers each rule in _headers ends up giving its files, the way Cloudflare applies
 * them: every rule that covers a file adds its headers in order, a repeated header is
 * joined with a comma, and `! Name` drops what came before.
 */
export function parseHeaders(text: string) {
	const rules: { path: string; lines: [string, string | null][] }[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		if (!/^\s/.test(line)) {
			rules.push({ path: line.trim(), lines: [] });
			continue;
		}
		const detach = /^\s+!\s*([\w-]+)\s*$/.exec(line);
		const header = /^\s+([\w-]+):\s*(.*)$/.exec(line);
		if (detach?.[1]) rules.at(-1)?.lines.push([detach[1].toLowerCase(), null]);
		else if (header?.[1])
			rules
				.at(-1)
				?.lines.push([header[1].toLowerCase(), (header[2] ?? "").trim()]);
	}
	const result: Record<string, Record<string, string>> = {};
	for (const rule of rules) {
		const example = rule.path.replaceAll("*", "x");
		const headers: Record<string, string> = {};
		for (const other of rules) {
			if (!coversPath(other.path, example)) continue;
			for (const [name, value] of other.lines) {
				if (value === null) delete headers[name];
				else
					headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
			}
		}
		result[rule.path] = headers;
	}
	return result;
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
		format: 2,
		version: process.env.VAULY_VERSION || "dev",
		commit: buildCommit(),
		dirty: git(["status", "--porcelain", "--untracked-files=no"]) !== "",
		config,
		headers: parseHeaders(
			readFileSync(path.join(outDir, "_headers"), "utf8").toString(),
		),
		files,
		toolchain: toolchain(),
	};
}
