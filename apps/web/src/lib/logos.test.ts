import { describe, expect, test } from "bun:test";

import { brandDomain, logoDomain, logoUrl } from "./logos";

describe("brandDomain", () => {
	test("keeps only the part a brand owns", () => {
		expect(brandDomain("app.hubspot.com")).toBe("hubspot.com");
		expect(brandDomain("github.com")).toBe("github.com");
		expect(brandDomain("shop.example.co.uk")).toBe("example.co.uk");
	});

	test("never names a private network", () => {
		expect(brandDomain("192.168.1.1")).toBeNull();
		expect(brandDomain("nas.local")).toBeNull();
		expect(brandDomain("grafana.corp")).toBeNull();
		expect(brandDomain("intranet.acme.test")).toBeNull();
		expect(brandDomain("localhost")).toBeNull();
	});
});

describe("logoDomain", () => {
	test("uses the website, then a well-known name", () => {
		expect(
			logoDomain({
				kind: "login",
				name: "Work",
				url: "https://www.figma.com/login",
			}),
		).toBe("figma.com");
		expect(logoDomain({ kind: "api-key", name: "Stripe live key" })).toBe(
			"stripe.com",
		);
		expect(logoDomain({ kind: "api-key", name: "OpenAI API key" })).toBe(
			"openai.com",
		);
	});

	test("notes and unknown names keep the plain icon", () => {
		expect(logoDomain({ kind: "note", name: "Apple pie recipe" })).toBeNull();
		expect(logoDomain({ kind: "login", name: "Door codes" })).toBeNull();
		expect(
			logoDomain({ kind: "login", name: "Router", url: "http://10.0.0.1" }),
		).toBeNull();
	});
});

test("logoUrl asks for a square icon twice the size, and a 404 when there's none", () => {
	expect(logoUrl("github.com", 28)).toMatch(
		/^https:\/\/cdn\.brandfetch\.io\/github\.com\/w\/56\/h\/56\/fallback\/404\/icon\?c=/,
	);
});
