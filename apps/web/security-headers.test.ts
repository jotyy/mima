import { describe, expect, test } from "bun:test";

import { contentSecurityPolicy, headersFile } from "./security-headers";

const directive = (policy: string, name: string) =>
	policy
		.split("; ")
		.find((part) => part.startsWith(`${name} `))
		?.split(" ")
		.slice(1);

describe("contentSecurityPolicy", () => {
	test("runs only the app's own scripts and can't be framed", () => {
		const policy = contentSecurityPolicy({ server: "", logos: true });
		expect(directive(policy, "script-src")).toEqual(["'self'"]);
		expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
		expect(directive(policy, "object-src")).toEqual(["'none'"]);
		expect(directive(policy, "base-uri")).toEqual(["'none'"]);
		expect(policy).not.toContain("unsafe-eval");
	});

	test("talks to the API on its own domain, and only to its origin", () => {
		const policy = contentSecurityPolicy({
			server: "https://api.vauly.example.test/some/path",
			logos: true,
		});
		expect(directive(policy, "connect-src")).toEqual([
			"'self'",
			"https://api.vauly.example.test",
		]);
	});

	test("talks only to itself when the app and the API share a Worker", () => {
		const policy = contentSecurityPolicy({ server: "", logos: true });
		expect(directive(policy, "connect-src")).toEqual(["'self'"]);
	});

	test("allows Brandfetch only while logos are on", () => {
		const on = contentSecurityPolicy({ server: "", logos: true });
		const off = contentSecurityPolicy({ server: "", logos: false });
		expect(directive(on, "img-src")).toContain("https://cdn.brandfetch.io");
		expect(off).not.toContain("brandfetch");
	});
});

describe("headersFile", () => {
	test("applies every header to every path", () => {
		const file = headersFile({ server: "", logos: true });
		const [, rule, ...headers] = file.trimEnd().split("\n");
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
});
