import { describe, expect, test } from "bun:test";

import { parseHeaders } from "./build-manifest";
import {
	contentSecurityPolicy,
	type HeaderOptions,
	headersFile,
	KEY_WORKER_DIR,
	keyWorkerPolicy,
} from "./security-headers";

const options: HeaderOptions = { server: "", logos: true, breaches: true };

const directive = (policy: string, name: string) =>
	policy
		.split("; ")
		.find((part) => part.startsWith(`${name} `))
		?.split(" ")
		.slice(1);

describe("contentSecurityPolicy", () => {
	test("runs only the app's own scripts and can't be framed", () => {
		const policy = contentSecurityPolicy(options);
		expect(directive(policy, "script-src")).toEqual(["'self'"]);
		expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
		expect(directive(policy, "object-src")).toEqual(["'none'"]);
		expect(directive(policy, "base-uri")).toEqual(["'none'"]);
		expect(policy).not.toContain("unsafe-eval");
	});

	test("talks to the API on its own domain, and only to its origin", () => {
		const policy = contentSecurityPolicy({
			...options,
			server: "https://api.vauly.example.test/some/path",
			breaches: false,
		});
		expect(directive(policy, "connect-src")).toEqual([
			"'self'",
			"https://api.vauly.example.test",
		]);
	});

	test("talks only to itself when the app and the API share a Worker", () => {
		const policy = contentSecurityPolicy({ ...options, breaches: false });
		expect(directive(policy, "connect-src")).toEqual(["'self'"]);
	});

	test("allows Brandfetch only while logos are on", () => {
		const on = contentSecurityPolicy({ ...options, logos: true });
		const off = contentSecurityPolicy({ ...options, logos: false });
		expect(directive(on, "img-src")).toContain("https://cdn.brandfetch.io");
		expect(off).not.toContain("brandfetch");
	});

	test("asks Have I Been Pwned only while the breach check is on", () => {
		const on = contentSecurityPolicy({ ...options, breaches: true });
		const off = contentSecurityPolicy({ ...options, breaches: false });
		expect(directive(on, "connect-src")).toEqual([
			"'self'",
			"https://api.pwnedpasswords.com",
		]);
		expect(off).not.toContain("pwnedpasswords");
	});
});

describe("keyWorkerPolicy", () => {
	test("lets the key worker compile WebAssembly and nothing else", () => {
		const policy = keyWorkerPolicy();
		expect(directive(policy, "default-src")).toEqual(["'none'"]);
		expect(directive(policy, "script-src")).toEqual([
			"'self'",
			"'wasm-unsafe-eval'",
		]);
		expect(policy).not.toContain("connect-src");
		expect(contentSecurityPolicy(options)).not.toContain("wasm");
	});
});

describe("headersFile", () => {
	test("applies every header to every path", () => {
		const file = headersFile(options);
		const [, rule, ...lines] = file.trimEnd().split("\n");
		const headers = lines.slice(0, lines.indexOf(""));
		expect(rule).toBe("/*");
		expect(headers.map((line) => line.split(":")[0]?.trim())).toEqual([
			"Content-Security-Policy",
			"X-Frame-Options",
			"X-Content-Type-Options",
			"Referrer-Policy",
			"Permissions-Policy",
			"Cross-Origin-Opener-Policy",
			"Strict-Transport-Security",
		]);
		expect(file).not.toContain("preload");
	});

	test("gives the key worker's files its policy instead of the page's", () => {
		const rules = parseHeaders(headersFile(options));
		const page = rules["/*"] ?? {};
		const worker = rules[`/${KEY_WORKER_DIR}/*`] ?? {};
		expect(page["content-security-policy"]).toBe(
			contentSecurityPolicy(options),
		);
		expect(worker["content-security-policy"]).toBe(keyWorkerPolicy());
		const { "content-security-policy": _, ...rest } = page;
		expect(worker).toMatchObject(rest);
	});
});

describe("parseHeaders", () => {
	test("reads each rule the way Cloudflare applies it", () => {
		const rules = parseHeaders(
			[
				"# A comment",
				"/*",
				"  X-One: a",
				"  X-Two: b",
				"",
				"/sub/*",
				"  ! X-One",
				"  X-One: c",
				"  X-Two: d",
			].join("\n"),
		);
		expect(rules).toEqual({
			"/*": { "x-one": "a", "x-two": "b" },
			"/sub/*": { "x-one": "c", "x-two": "b, d" },
		});
	});
});
