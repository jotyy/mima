import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@playwright/test";

// The promo tiles: the website's sky, ciphertext and keyhole, at the store's sizes. The
// pages are the website's own (apps/site/src/pages/store/), served here by Astro's dev
// server in this process, or by one already running at STORE_SITE_URL.

const store = path.resolve(import.meta.dirname, "../../apps/extension/store");
const site = path.resolve(import.meta.dirname, "../../apps/site");

let url = process.env.STORE_SITE_URL ?? "";
let stop: (() => Promise<void>) | undefined;

test.beforeAll(async () => {
	if (url) return;
	execFileSync("bun", ["scripts/sync-docs.ts"], { cwd: site, stdio: "ignore" });
	const astro = (await import(
		pathToFileURL(
			createRequire(path.join(site, "package.json")).resolve("astro"),
		).href
	)) as typeof import("astro");
	const server = await astro.dev({
		root: site,
		logLevel: "error",
		server: { port: 4400 },
	});
	url = `http://localhost:${server.address.port}`;
	stop = () => server.stop();
});

test.afterAll(async () => {
	await stop?.();
});

for (const [name, width, height] of [
	["promo-small", 440, 280],
	["promo-marquee", 1400, 560],
] as const) {
	test(name, async ({ browser }) => {
		const page = await browser.newPage({
			viewport: { width, height },
			deviceScaleFactor: 1,
		});
		await page.goto(`${url}/store/${name}`, { waitUntil: "networkidle" });
		await page.evaluate(() => document.fonts.ready);
		await page.locator("[data-slot='cipher-field'][data-ready]").waitFor();
		await page.screenshot({ path: path.join(store, `${name}.png`) });
		await page.close();
	});
}
