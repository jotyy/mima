// Saves the social cards (src/pages/og/) under public/social/: home.jpg for the landing
// page and docs.jpg or docs/<page>.jpg for each docs page, the paths src/routeData.ts
// links. Run it with the dev server up: `bun run og`.
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public/social");
const docs = (await readdir(path.join(root, "src/content/docs/docs"))).map(
	(file) => file.replace(/\.mdx?$/, ""),
);
const cards = [
	{ route: "/og", file: "home.jpg" },
	...docs.map((page) =>
		page === "index"
			? { route: "/og/docs", file: "docs.jpg" }
			: { route: `/og/docs/${page}`, file: `docs/${page}.jpg` },
	),
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const card of cards) {
	await page.goto(`http://localhost:4321${card.route}`, {
		waitUntil: "networkidle",
	});
	await page.evaluate(() => document.fonts.ready);
	const file = path.join(out, card.file);
	await mkdir(path.dirname(file), { recursive: true });
	await page.screenshot({ path: file, type: "jpeg", quality: 90 });
	console.log(`Saved ${path.relative(root, file)}`);
}
await browser.close();
