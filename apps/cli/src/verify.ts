import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// vauly verify <url>: checks that a vauly instance serves the web app a given commit
// builds. It reads the instance's /.well-known/vauly-build.json, downloads every file it
// lists and the headers it's served with, and compares them with a build it trusts: one
// it makes itself from that commit, or a manifest you give it (a release's, say).
// docs/security.md says what this proves, and what it can't.

export const REPOSITORY = "https://github.com/jotyy/vauly.git";

export type BuildManifest = {
	format: 1;
	version: string;
	commit: string;
	dirty: boolean;
	config: Record<string, unknown>;
	headers: Record<string, string>;
	files: Record<string, string>;
};

export type Difference = {
	/** A path, or "header <name>". */
	what: string;
	problem: "differs" | "missing" | "unexpected";
	detail?: string;
};

export type Report = {
	url: string;
	commit: string;
	version: string;
	config: Record<string, unknown>;
	checked: number;
	/** What the instance serves that doesn't match its own manifest. */
	served: Difference[];
	/** Where the instance's build differs from the trusted one; null if none was compared. */
	reference: { source: string; differences: Difference[] } | null;
	/** Why a comparison couldn't happen, when it couldn't. */
	notes: string[];
};

export class VerifyError extends Error {}

const sha256 = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

/** Parses a manifest, refusing anything that doesn't look like one. */
export function parseManifest(text: string): BuildManifest {
	const value = JSON.parse(text) as Partial<BuildManifest>;
	if (
		value.format !== 1 ||
		typeof value.commit !== "string" ||
		!value.files ||
		typeof value.files !== "object"
	) {
		throw new VerifyError("That isn't a vauly build manifest.");
	}
	return {
		format: 1,
		version: String(value.version ?? ""),
		commit: value.commit,
		dirty: value.dirty === true,
		config: value.config ?? {},
		headers: value.headers ?? {},
		files: value.files,
	};
}

/** Paths that index.html and the service worker load, which must all be in the manifest. */
export function referencedPaths(html: string, serviceWorker: string) {
	const paths = new Set<string>();
	for (const [, value] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
		if (
			value &&
			!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(value) &&
			!value.startsWith("#")
		) {
			paths.add(value.startsWith("/") ? value : `/${value}`);
		}
	}
	for (const [, value] of serviceWorker.matchAll(/\burl:\s*"([^"]+)"/g)) {
		if (value) paths.add(value.startsWith("/") ? value : `/${value}`);
	}
	for (const [, value] of serviceWorker.matchAll(
		/importScripts\(\s*"([^"]+)"/g,
	)) {
		if (value) paths.add(value.startsWith("/") ? value : `/${value}`);
	}
	return [...paths].map((value) => value.split(/[?#]/)[0] ?? value).sort();
}

/** The two manifests' files and, when they were built for the same settings, headers. */
export function compareManifests(
	served: BuildManifest,
	trusted: BuildManifest,
): { differences: Difference[]; notes: string[] } {
	const differences: Difference[] = [];
	const notes: string[] = [];
	const paths = new Set([
		...Object.keys(served.files),
		...Object.keys(trusted.files),
	]);
	for (const file of [...paths].sort()) {
		const mine = served.files[file];
		const theirs = trusted.files[file];
		if (mine === theirs) continue;
		differences.push({
			what: file,
			problem: !theirs ? "unexpected" : !mine ? "missing" : "differs",
		});
	}
	if (JSON.stringify(served.config) === JSON.stringify(trusted.config)) {
		const names = new Set([
			...Object.keys(served.headers),
			...Object.keys(trusted.headers),
		]);
		for (const name of [...names].sort()) {
			if (served.headers[name] === trusted.headers[name]) continue;
			differences.push({
				what: `header ${name}`,
				problem: !trusted.headers[name]
					? "unexpected"
					: !served.headers[name]
						? "missing"
						: "differs",
				detail: `expected: ${trusted.headers[name] ?? "(none)"}`,
			});
		}
	} else {
		notes.push(
			"The trusted manifest was built with other settings, so the headers weren't compared. Rebuild (the default) to compare them.",
		);
	}
	return { differences, notes };
}

/** Downloads what the instance serves and checks it against its own manifest. */
export async function checkServed(
	url: string,
	fetcher: typeof fetch = fetch,
): Promise<{ manifest: BuildManifest; served: Difference[]; checked: number }> {
	const base = url.replace(/\/+$/, "");
	const response = await fetcher(`${base}/.well-known/vauly-build.json`).catch(
		() => {
			throw new VerifyError(`Couldn't reach ${base}.`);
		},
	);
	if (!response.ok) {
		throw new VerifyError(
			`${base} doesn't publish /.well-known/vauly-build.json (${response.status}). It may run a version from before vauly verify.`,
		);
	}
	const manifest = parseManifest(await response.text());
	const served: Difference[] = [];
	const bodies = new Map<string, Uint8Array>();
	const paths = Object.keys(manifest.files);
	let next = 0;
	const worker = async () => {
		while (next < paths.length) {
			const file = paths[next++] as string;
			// Cloudflare sends /index.html on to /, so a redirect is followed, within the
			// instance's own address only.
			const answer = await fetcher(`${base}${file}`);
			if (answer.url && new URL(answer.url).origin !== new URL(base).origin) {
				served.push({
					what: file,
					problem: "differs",
					detail: `redirects to ${answer.url}`,
				});
				continue;
			}
			if (!answer.ok) {
				served.push({
					what: file,
					problem: "missing",
					detail: `HTTP ${answer.status}`,
				});
				continue;
			}
			const body = new Uint8Array(await answer.arrayBuffer());
			bodies.set(file, body);
			if (sha256(body) !== manifest.files[file]) {
				served.push({ what: file, problem: "differs" });
			}
		}
	};
	await Promise.all(Array.from({ length: 8 }, worker));

	// The page at / is the one everyone gets, with its headers.
	const root = await fetcher(`${base}/`);
	const rootBody = new Uint8Array(await root.arrayBuffer());
	if (sha256(rootBody) !== manifest.files["/index.html"]) {
		served.push({
			what: "/",
			problem: "differs",
			detail: "isn't the listed index.html",
		});
	}
	for (const [name, value] of Object.entries(manifest.headers)) {
		const actual = root.headers.get(name);
		if (actual !== value) {
			served.push({
				what: `header ${name}`,
				problem: actual === null ? "missing" : "differs",
				detail: `served: ${actual ?? "(none)"}`,
			});
		}
	}

	// Nothing the page or the service worker loads may be left out of the manifest.
	const decoder = new TextDecoder();
	const referenced = referencedPaths(
		decoder.decode(rootBody),
		decoder.decode(bodies.get("/sw.js") ?? new Uint8Array()),
	);
	for (const file of referenced) {
		if (!(file in manifest.files) && file !== "/") {
			served.push({
				what: file,
				problem: "unexpected",
				detail: "loaded by the app but not in the manifest",
			});
		}
	}
	return { manifest, served, checked: paths.length };
}

function run(command: string, args: string[], cwd: string, env = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: { ...process.env, ...env },
		encoding: "utf8",
	});
	if (result.error) {
		throw new VerifyError(
			`Rebuilding needs ${command}, which isn't installed. Install it, or pass --against <manifest>.`,
		);
	}
	if (result.status !== 0) {
		throw new VerifyError(
			`${command} ${args.join(" ")} failed:\n${(result.stderr || result.stdout).trim().slice(-2000)}`,
		);
	}
	return result.stdout.trim();
}

/** The build settings an instance's config names, as the web build reads them. */
export function buildEnv(config: Record<string, unknown>) {
	const demo = config.demo as { email?: string; password?: string } | undefined;
	return {
		VITE_SERVER_URL: String(config.server ?? ""),
		VITE_BRANDFETCH_CLIENT_ID: String(config.brandfetch ?? ""),
		VITE_BREACH_CHECK: config.breachCheck === false ? "off" : "",
		VITE_DEMO_EMAIL: demo?.email ?? "",
		VITE_DEMO_PASSWORD: demo?.password ?? "",
	};
}

/**
 * Builds the web app from `commit` with the instance's settings and returns its manifest.
 * `source` is a checkout to build in (at that commit); otherwise a fresh clone is used.
 */
export function rebuild(
	commit: string,
	config: Record<string, unknown>,
	options: { source?: string; repository?: string } = {},
): BuildManifest {
	const temporary = options.source
		? null
		: mkdtempSync(path.join(tmpdir(), "vauly-verify-"));
	const dir = options.source ?? (temporary as string);
	try {
		if (temporary) {
			run(
				"git",
				[
					"clone",
					"--quiet",
					"--filter=blob:none",
					options.repository ?? REPOSITORY,
					dir,
				],
				tmpdir(),
			);
			run("git", ["checkout", "--quiet", commit], dir);
		} else if (run("git", ["rev-parse", "HEAD"], dir) !== commit) {
			throw new VerifyError(
				`${dir} isn't at ${commit.slice(0, 12)}. Check that commit out first, or leave out --source.`,
			);
		}
		run("bun", ["install", "--frozen-lockfile"], dir);
		run("bun", ["run", "--cwd", "apps/web", "build"], dir, {
			...buildEnv(config),
			GITHUB_SHA: commit,
		});
		return parseManifest(
			readFileSync(
				path.join(dir, "apps/web/dist/.well-known/vauly-build.json"),
				"utf8",
			),
		);
	} finally {
		if (temporary) rmSync(temporary, { recursive: true, force: true });
	}
}

/** Reads a trusted manifest from a file or a URL. */
export async function loadManifest(
	location: string,
	fetcher: typeof fetch = fetch,
): Promise<BuildManifest> {
	if (/^https?:\/\//.test(location)) {
		const response = await fetcher(location);
		if (!response.ok) {
			throw new VerifyError(
				`Couldn't download ${location} (${response.status}).`,
			);
		}
		return parseManifest(await response.text());
	}
	return parseManifest(readFileSync(location, "utf8"));
}

export async function verify(
	url: string,
	options: {
		against?: string;
		source?: string;
		repository?: string;
		fetcher?: typeof fetch;
		rebuilder?: typeof rebuild;
	} = {},
): Promise<Report> {
	const base = (/^https?:\/\//.test(url) ? url : `https://${url}`).replace(
		/\/+$/,
		"",
	);
	const { manifest, served, checked } = await checkServed(
		base,
		options.fetcher,
	);
	const report: Report = {
		url: base,
		commit: manifest.commit,
		version: manifest.version,
		config: manifest.config,
		checked,
		served,
		reference: null,
		notes: [],
	};
	if (options.against) {
		const trusted = await loadManifest(options.against, options.fetcher);
		const { differences, notes } = compareManifests(manifest, trusted);
		report.reference = { source: options.against, differences };
		report.notes.push(...notes);
		if (trusted.commit !== manifest.commit) {
			report.notes.push(
				`The trusted manifest is for ${trusted.commit.slice(0, 12)}, the instance says ${manifest.commit.slice(0, 12)}.`,
			);
		}
		return report;
	}
	if (manifest.dirty || !/^[0-9a-f]{40}$/.test(manifest.commit)) {
		report.notes.push(
			"The instance was built from a working tree with changes, or without a commit, so no one can build the same files.",
		);
		return report;
	}
	const trusted = (options.rebuilder ?? rebuild)(
		manifest.commit,
		manifest.config,
		{
			source: options.source,
			repository: options.repository,
		},
	);
	const { differences, notes } = compareManifests(manifest, trusted);
	report.reference = {
		source: `a build of ${manifest.commit.slice(0, 12)}`,
		differences,
	};
	report.notes.push(...notes);
	return report;
}

/** 0: everything matches; 1: something differs; 2: nothing trusted to compare with. */
export function exitCode(report: Report) {
	if (
		report.served.length > 0 ||
		(report.reference?.differences.length ?? 0) > 0
	) {
		return 1;
	}
	return report.reference ? 0 : 2;
}

export function formatReport(report: Report) {
	const line = (difference: Difference) =>
		`  ✗ ${difference.what}: ${difference.problem}${difference.detail ? ` (${difference.detail})` : ""}`;
	const out = [
		`${report.url} serves vauly ${report.version} built from ${report.commit || "an unknown commit"}.`,
		`Settings: ${JSON.stringify(report.config)}`,
		"",
	];
	if (report.served.length === 0) {
		out.push(
			`✓ All ${report.checked} files, the page at / and its headers match the instance's own manifest.`,
		);
	} else {
		out.push("What the instance serves doesn't match its own manifest:");
		out.push(...report.served.map(line));
	}
	if (report.reference) {
		if (report.reference.differences.length === 0) {
			out.push(`✓ They match ${report.reference.source}.`);
		} else {
			out.push(`They don't match ${report.reference.source}:`);
			out.push(...report.reference.differences.map(line));
		}
	}
	for (const note of report.notes) out.push(`! ${note}`);
	const code = exitCode(report);
	out.push(
		"",
		code === 0
			? "Verified: this is what that commit builds, as served to you just now."
			: code === 1
				? "Not verified: the files above differ."
				: "Not verified: there was nothing trusted to compare with.",
	);
	return out.join("\n");
}
