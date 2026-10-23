import { expect, test } from "@playwright/test";

// Every instance tells researchers, in /.well-known/security.txt (RFC 9116), to report a
// problem to the project. It's a file of its own, not the app's page for unknown paths.
test("the instance serves a security.txt that hasn't expired", async ({
	request,
}) => {
	const response = await request.get("/.well-known/security.txt");
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("text/plain");
	const text = await response.text();
	expect(text).toContain(
		"Contact: https://github.com/jotyy/vauly/security/advisories/new",
	);
	expect(text).toContain("Policy: https://vauly.app/docs/security-policy/");
	const expires = /^Expires: (.+)$/m.exec(text)?.[1] ?? "";
	const left = new Date(expires).getTime() - Date.now();
	expect(left).toBeGreaterThan(300 * 24 * 60 * 60 * 1000);
	expect(left).toBeLessThan(366 * 24 * 60 * 60 * 1000);
});
