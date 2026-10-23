import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

import { API_URL } from "../playwright.config";
import { vauly } from "./cli";

// `vauly verify` against the one-Worker run, which serves the production build the way
// Cloudflare does: the files, the headers from _headers, and /vauly.json from the Worker.

test.skip(
	!process.env.VAULY_E2E_ONE_WORKER,
	"Only the one-Worker run serves the build.",
);

const MANIFEST = fileURLToPath(
	new URL("../../apps/web/dist/.well-known/vauly-build.json", import.meta.url),
);

test("the instance publishes its build manifest and settings", async ({
	request,
}) => {
	const manifest = await (
		await request.get(`${API_URL}/.well-known/vauly-build.json`)
	).json();
	expect(manifest.format).toBe(1);
	expect(Object.keys(manifest.files)).toContain("/index.html");
	expect(Object.keys(manifest.files)).toContain("/sw.js");
	expect(manifest.headers["content-security-policy"]).toContain(
		"script-src 'self'",
	);

	// The Worker answers /vauly.json from the build's own file, with its address as the API's.
	const config = await (await request.get(`${API_URL}/vauly.json`)).json();
	expect(config.server).toBe(API_URL);
	expect(config.breachCheck).toBe(true);
});

test("vauly verify finds the served build matches", async () => {
	const run = vauly(["verify", API_URL, "--against", MANIFEST], {});
	const code = await run.exit;
	expect(run.stdout()).toContain("All");
	expect(run.stdout()).toContain("Verified");
	expect(code).toBe(0);
});

test("vauly verify names a file the trusted build doesn't have", async () => {
	const trusted = JSON.parse(readFileSync(MANIFEST, "utf8"));
	const [first] = Object.keys(trusted.files).filter((file) =>
		file.startsWith("/assets/"),
	);
	if (!first) throw new Error("No assets in the manifest");
	trusted.files[first] = "0".repeat(64);
	const dir = fileURLToPath(new URL("../results", import.meta.url));
	mkdirSync(dir, { recursive: true });
	const file = `${dir}/tampered-manifest.json`;
	writeFileSync(file, JSON.stringify(trusted));
	const run = vauly(["verify", API_URL, "--against", file], {});
	expect(await run.exit).toBe(1);
	expect(run.stdout()).toContain(`${first}: differs`);
});
