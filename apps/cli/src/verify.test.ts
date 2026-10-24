import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	type BuildManifest,
	exitCode,
	formatReport,
	parseManifest,
	referencedPaths,
	VerifyError,
	verify,
} from "./verify";

// A made-up instance: a page, a script, a service worker and their manifest, served by a
// local server that a test can tamper with.

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const COMMIT = "a".repeat(40);
const CSP = "default-src 'self'; script-src 'self'";
const WORKER_CSP =
	"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; frame-ancestors 'none'";
const WORKER_RULE = "/assets/key-worker/*";

const files: Record<string, string> = {
	"/index.html":
		'<!doctype html><script type="module" src="/assets/index-abc.js"></script><link rel="manifest" href="/manifest.webmanifest">',
	"/assets/index-abc.js": "console.log('vauly')",
	"/manifest.webmanifest": "{}",
	"/sw.js":
		'importScripts("/workbox-1.js");precacheAndRoute([{url:"assets/index-abc.js",revision:null},{url:"index.html",revision:"1"}])',
	"/workbox-1.js": "// workbox",
	"/assets/key-worker/argon2.worker-abc.js": "// argon2",
};

/** Each file's headers, the way _headers gives them: the key worker's own policy. */
const servedHeaders = (pathname: string) =>
	pathname.startsWith("/assets/key-worker/")
		? { "content-security-policy": WORKER_CSP }
		: { "content-security-policy": CSP };

function manifestOf(
	served: Record<string, string>,
	extra: Partial<BuildManifest> = {},
): BuildManifest {
	return {
		format: 2,
		version: "0.1.0",
		commit: COMMIT,
		dirty: false,
		config: { server: "", brandfetch: "", breachCheck: true },
		headers: {
			"/*": { "content-security-policy": CSP },
			[WORKER_RULE]: { "content-security-policy": WORKER_CSP },
		},
		files: Object.fromEntries(
			Object.entries(served).map(([file, body]) => [file, sha(body)]),
		),
		...extra,
	};
}

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

/** Serves `served` and `manifest` the way an instance would. */
function instance(
	served: Record<string, string>,
	manifest: BuildManifest | null,
	headers: (pathname: string) => Record<string, string> = servedHeaders,
) {
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === "/.well-known/vauly-build.json") {
				return manifest
					? Response.json(manifest)
					: new Response("Not found", { status: 404 });
			}
			const body = served[pathname === "/" ? "/index.html" : pathname];
			if (body === undefined) return new Response("Not found", { status: 404 });
			return new Response(body, { headers: headers(pathname) });
		},
	});
	servers.push(server);
	return `http://localhost:${server.port}`;
}

function trusted(manifest: BuildManifest) {
	const file = path.join(
		mkdtempSync(path.join(tmpdir(), "vauly-test-")),
		"m.json",
	);
	writeFileSync(file, JSON.stringify(manifest));
	return file;
}

test("an instance that serves its commit's files is verified", async () => {
	const manifest = manifestOf(files);
	const report = await verify(instance(files, manifest), {
		against: trusted(manifest),
	});
	expect(report.served).toEqual([]);
	expect(report.reference?.differences).toEqual([]);
	expect(exitCode(report)).toBe(0);
	expect(formatReport(report)).toContain("Verified");
});

test("a changed file is named", async () => {
	const manifest = manifestOf(files);
	const tampered = {
		...files,
		"/assets/index-abc.js": "steal(masterPassword)",
	};
	const report = await verify(instance(tampered, manifest), {
		against: trusted(manifest),
	});
	expect(report.served).toEqual([
		{ what: "/assets/index-abc.js", problem: "differs" },
	]);
	expect(exitCode(report)).toBe(1);
});

test("a script added beside a matching manifest is still caught", async () => {
	// The host rewrote the page and its own manifest to match; the trusted build differs.
	const tampered = {
		...files,
		"/index.html": `${files["/index.html"]}<script src="/evil.js"></script>`,
	};
	const report = await verify(instance(tampered, manifestOf(tampered)), {
		against: trusted(manifestOf(files)),
	});
	expect(report.served).toContainEqual(
		expect.objectContaining({ what: "/evil.js", problem: "unexpected" }),
	);
	expect(report.reference?.differences).toEqual([
		{ what: "/index.html", problem: "differs" },
	]);
	expect(exitCode(report)).toBe(1);
});

test("a weaker Content-Security-Policy is caught", async () => {
	const manifest = manifestOf(files);
	const report = await verify(
		instance(files, manifest, (pathname) => ({
			...servedHeaders(pathname),
			...(pathname === "/" && {
				"content-security-policy": `${CSP} 'unsafe-eval'`,
			}),
		})),
		{ against: trusted(manifest) },
	);
	expect(report.served).toContainEqual(
		expect.objectContaining({
			what: "header content-security-policy",
			problem: "differs",
		}),
	);
	expect(exitCode(report)).toBe(1);
});

test("the key worker's files must have its policy, not another", async () => {
	const manifest = manifestOf(files);
	const report = await verify(
		instance(files, manifest, () => ({ "content-security-policy": CSP })),
		{ against: trusted(manifest) },
	);
	expect(report.served).toEqual([
		{
			what: "header content-security-policy on /assets/key-worker/argon2.worker-abc.js",
			problem: "differs",
			detail: `served: ${CSP}`,
		},
	]);
	expect(exitCode(report)).toBe(1);
});

test("a build in another runtime is named as the likely reason", async () => {
	// Vite's output depends on the runtime it ran in (apps/web/build-manifest.ts).
	const served = manifestOf(files, { toolchain: { bun: "1.3.14" } });
	const other = manifestOf(
		{ ...files, "/assets/index-abc.js": "console.log('vauly', 1)" },
		{ toolchain: { node: "24.16.0" } },
	);
	const report = await verify(instance(files, served), {
		against: trusted(other),
	});
	expect(exitCode(report)).toBe(1);
	expect(report.notes.join(" ")).toContain(
		"built in Bun 1.3.14 and the build it's compared with in Node 24.16.0",
	);
	// The same runtime on both sides says nothing about it.
	const same = await verify(instance(files, served), {
		against: trusted({ ...other, toolchain: { bun: "1.3.14" } }),
	});
	expect(same.notes.join(" ")).not.toContain("runtime");
});

test("a manifest from before per-rule headers still reads", () => {
	const old = { ...manifestOf(files), format: 1, headers: { "x-one": "a" } };
	expect(parseManifest(JSON.stringify(old)).headers).toEqual({
		"/*": { "x-one": "a" },
	});
});

test("the default rebuilds the instance's commit with its settings", async () => {
	const manifest = manifestOf(files);
	let asked = null as { commit: string; config: unknown } | null;
	const report = await verify(instance(files, manifest), {
		rebuilder: (commit, config) => {
			asked = { commit, config };
			return manifestOf(files);
		},
	});
	expect(asked).toEqual({ commit: COMMIT, config: manifest.config });
	expect(exitCode(report)).toBe(0);
});

test("a build from a dirty tree can't be checked", async () => {
	const manifest = manifestOf(files, { dirty: true });
	const report = await verify(instance(files, manifest), {
		rebuilder: () => {
			throw new Error("should not rebuild");
		},
	});
	expect(exitCode(report)).toBe(2);
	expect(report.notes.join(" ")).toContain("working tree with changes");
});

test("an instance without a manifest says so", async () => {
	await expect(verify(instance(files, null))).rejects.toThrow(VerifyError);
});

test("the page's and the service worker's files are all found", () => {
	expect(
		referencedPaths(files["/index.html"] ?? "", files["/sw.js"] ?? ""),
	).toEqual([
		"/assets/index-abc.js",
		"/index.html",
		"/manifest.webmanifest",
		"/workbox-1.js",
	]);
});
