import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Browser, expect, type Page, test } from "@playwright/test";

import {
	addItem,
	addVault,
	engineering,
	finance,
	marketing,
	personal,
} from "../example-team";
import { API_URL } from "../playwright.config";
import {
	apiFromPage,
	createWorkspace,
	openAllItems,
	resetWorkspace,
	sidebarLink,
} from "../tests/helpers";

// The launch images: real pictures of the app, the CLI and the extension, with the example
// team's made-up items, laid out on the website's pages (apps/site/src/pages/social/).
// The pictures and texts reach those pages as /social-input/..., answered from here.

test.describe.configure({ mode: "serial" });

const root = path.resolve(import.meta.dirname, "../..");
const site = path.join(root, "apps/site");
const out = path.join(root, "brand/social");
const storeShots = path.join(root, "apps/extension/store");
const cli = fileURLToPath(
	new URL("../../apps/cli/src/index.ts", import.meta.url),
);

const inputs = new Map<string, Buffer>();
const data: Record<string, string> = {};
let url = "";
let stop: (() => Promise<void>) | undefined;

const images = {
	banner: [1500, 500],
	"tweet-1-hero": [1600, 900],
	"tweet-2-ciphertext": [1600, 900],
	"tweet-3-agents": [1600, 900],
	"tweet-4-import": [1600, 900],
	"tweet-5-extension": [1600, 900],
	"tweet-6-deploy": [1600, 900],
	"tweet-price": [1600, 900],
	"tweet-1-hero-zh": [1600, 900],
	"tweet-3-agents-zh": [1600, 900],
	"tweet-price-zh": [1600, 900],
} as const;

/** The website, from Astro's dev server in this process, or one at SOCIAL_SITE_URL. */
async function serveSite() {
	url = process.env.SOCIAL_SITE_URL ?? "";
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
}

async function appPage(browser: Browser) {
	const page = await browser.newPage({
		viewport: { width: 1280, height: 800 },
		deviceScaleFactor: 2,
		colorScheme: "light",
	});
	return page;
}

/** Waits out the notifications from adding things, then a still picture. */
async function settle(page: Page) {
	await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
		timeout: 20_000,
	});
	await page.mouse.move(0, 0);
	await page.waitForTimeout(500);
}

test.beforeAll(async ({ browser, request }) => {
	test.setTimeout(600_000);
	mkdirSync(out, { recursive: true });
	await serveSite();
	await resetWorkspace(request);

	// The example team.
	const page = await appPage(browser);
	await createWorkspace(page);
	await sidebarLink(page, "Private").click();
	for (const item of personal) await addItem(page, item);
	await addVault(
		page,
		"Engineering",
		"Databases, cloud and deploy keys.",
		"Teal",
	);
	for (const item of engineering) await addItem(page, item);
	await addVault(
		page,
		"Marketing",
		"Social accounts, design tools, the newsletter.",
		"Violet",
	);
	for (const item of marketing) await addItem(page, item);
	await addVault(
		page,
		"Finance",
		"The bank, payments and the company card.",
		"Amber",
	);
	for (const item of finance) await addItem(page, item);

	// All items, with AWS root open: the app, and the item on its own.
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByText("AWS root")
		.click();
	await expect(page.getByText(/^\d{3} \d{3}$/)).toBeVisible();
	await settle(page);
	inputs.set("app.png", await page.screenshot());
	const detail = page
		.getByRole("main")
		.locator("section")
		.filter({ hasText: "Updated" })
		.first();
	inputs.set("item.png", await detail.screenshot());

	// The same item as the server stores it.
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const awsId = (
		(await page
			.getByRole("dialog")
			.getByText(/^vauly:\/\/itm_/)
			.textContent()) ?? ""
	)
		.trim()
		.replace("vauly://", "");
	await page.keyboard.press("Escape");
	const rows = JSON.parse(await apiFromPage(page, "items/list")).json as {
		id: string;
		vaultId: string;
		wrappedKey: string;
		data: string;
	}[];
	const row = rows.find((candidate) => candidate.id === awsId);
	if (!row) throw new Error("AWS root isn't in items/list");
	data.row = JSON.stringify(
		{
			id: row.id,
			vaultId: row.vaultId,
			wrappedKey: row.wrappedKey,
			data: `${row.data.slice(0, 260)}…`,
		},
		null,
		2,
	);

	// The import dialog, with the apps it reads.
	await page.getByRole("button", { name: "Import", exact: true }).click();
	const importDialog = page.getByRole("dialog");
	await expect(
		importDialog.getByRole("heading", { name: "Import from…" }),
	).toBeVisible();
	await page.waitForTimeout(400);
	inputs.set("import.png", await importDialog.screenshot());
	await page.keyboard.press("Escape");

	// An agent deploying with the Cloudflare token, and the card that asks for it.
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByText("Cloudflare API token")
		.click();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const cloudflare = (
		(await page
			.getByRole("dialog")
			.getByText(/^vauly:\/\/itm_/)
			.textContent()) ?? ""
	).trim();
	await page.keyboard.press("Escape");
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "New agent" }).first().click();
	const agentDialog = page.getByRole("dialog");
	await agentDialog.getByLabel("Name").fill("CI deploy");
	await agentDialog.getByRole("tab", { name: "CI job" }).click();
	await agentDialog.getByRole("button", { name: "Create agent" }).click();
	const env = agentDialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	const token =
		/VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await agentDialog.getByRole("button", { name: "I've stored it" }).click();

	const project = mkdtempSync(path.join(tmpdir(), "acme-web-"));
	writeFileSync(
		path.join(project, "package.json"),
		JSON.stringify({
			name: "acme-web",
			version: "1.0.0",
			private: true,
			scripts: { deploy: "node deploy.js" },
		}),
	);
	writeFileSync(
		path.join(project, "deploy.js"),
		[
			'console.log("Building acme-web… done in 3.2s");',
			"console.log(`Signing in to Cloudflare with ${process.env.CLOUDFLARE_API_TOKEN}`);",
			'console.log("Uploaded 14 files (1.8s)");',
			'console.log("Deployed acme-web to https://acme-web.example.workers.dev");',
		].join("\n"),
	);
	const run = spawn("bun", [cli, "run", "--", "npm", "run", "deploy"], {
		cwd: project,
		env: {
			...process.env,
			VAULY_SERVER: API_URL,
			VAULY_TOKEN: token,
			VAULY_APPROVAL_TIMEOUT: "120",
			CLOUDFLARE_API_TOKEN: cloudflare,
		},
	});
	let stdout = "";
	let stderr = "";
	run.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	run.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const exited = new Promise((resolve) => run.on("close", resolve));
	await expect
		.poll(() => stderr, { timeout: 60_000 })
		.toContain("needs approval");

	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "CI deploy wants Cloudflare API token",
	});
	await expect(card).toBeVisible();
	// As narrow as the card goes, so it reads at the size of a picture in a post.
	await card.evaluate((node) => {
		(node as HTMLElement).style.maxWidth = "460px";
	});
	await settle(page);
	inputs.set("approval.png", await card.screenshot());
	await card.getByRole("button", { name: "Allow once" }).click();
	await exited;
	expect(stdout).toContain("<hidden>");
	data.terminal = [
		"$ vauly run -- npm run deploy",
		stderr.trim(),
		"",
		stdout.trim().replace(/\n{2,}/g, "\n\n"),
	].join("\n");
	await page.close();

	// The extension, from its store pictures.
	inputs.set(
		"fill.png",
		readFileSync(path.join(storeShots, "screenshot-2.png")),
	);
	inputs.set(
		"passkey.png",
		readFileSync(path.join(storeShots, "screenshot-4.png")),
	);
});

test.afterAll(async () => {
	await stop?.();
});

for (const [name, [width, height]] of Object.entries(images)) {
	test(name, async ({ browser }) => {
		const page = await browser.newPage({
			viewport: { width, height },
			deviceScaleFactor: 1,
		});
		await page.route("**/social-input/**", (route) => {
			const file =
				new URL(route.request().url()).pathname.split("/").pop() ?? "";
			if (file === "data.json") return route.fulfill({ json: data });
			const png = inputs.get(file);
			return png
				? route.fulfill({ contentType: "image/png", body: png })
				: route.fulfill({ status: 404 });
		});
		await page.goto(`${url}/social/${name}`, { waitUntil: "networkidle" });
		await page.locator("html[data-filled]").waitFor();
		await page.evaluate(async () => {
			await document.fonts.ready;
			await Promise.all([...document.images].map((image) => image.decode()));
		});
		if (await page.locator("[data-slot='cipher-field']").count())
			await page.locator("[data-slot='cipher-field'][data-ready]").waitFor();
		await page.waitForTimeout(300);
		await page.screenshot({ path: path.join(out, `${name}.png`) });
		await page.close();
	});
}
