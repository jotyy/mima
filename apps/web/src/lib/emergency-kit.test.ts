import { describe, expect, test } from "bun:test";

import { emergencyKitHtml } from "./emergency-kit";

describe("emergencyKitHtml", () => {
	const kit = {
		name: "Alex Kim",
		email: "alex@acme.test",
		workspace: "Acme <Ops>",
		address: "https://vauly.example.test",
	};

	test("holds the sign-in details and a blank for the master password", () => {
		const html = emergencyKitHtml(kit);
		expect(html).toContain("alex@acme.test");
		expect(html).toContain("https://vauly.example.test");
		expect(html).toContain('<span class="blank"></span>');
	});

	test("escapes what people typed", () => {
		const html = emergencyKitHtml(kit);
		expect(html).toContain("Acme &lt;Ops&gt;");
		expect(html).not.toContain("Acme <Ops>");
	});
});
