import { describe, expect, test } from "bun:test";

import {
	contentSecurityPolicy,
	type HeaderOptions,
	headersFile,
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

describe("headersFile", () => {
	test("applies every header to every path", () => {
		const file = headersFile(options);
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
