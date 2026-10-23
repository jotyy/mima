// Saves the social preview (src/pages/og.astro) as public/og.png. Run it with the dev
// server up: `bun run og`.
import path from "node:path";
import { chromium } from "@playwright/test";

const out = path.resolve(import.meta.dirname, "../public/og.png");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("http://localhost:4321/og", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: out });
await browser.close();
console.log(`Saved ${out}`);
