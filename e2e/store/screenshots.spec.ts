import { execFileSync } from "node:child_process";
import path from "node:path";
import {
	type BrowserContext,
	chromium,
	expect,
	type Page,
	test,
	type Worker,
} from "@playwright/test";

import {
	addItem,
	addVault,
	engineering,
	finance,
	marketing,
	personal,
} from "../example-team";
import { WEB_PORT } from "../playwright.config";
import {
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
} from "../tests/helpers";

// The Chrome Web Store's screenshots of the extension, 1280 × 800: the real extension, the
// example team's made-up items, and sites of made-up companies served at made-up
// addresses. The popup and vauly's windows are photographed on their own and laid over
// the page they belong to, the way they sit over it in Chrome.

test.describe.configure({ mode: "serial" });

const extensionDir = path.resolve(import.meta.dirname, "../../apps/extension");
const extensionPath = path.join(extensionDir, ".output/chrome-mv3");
const store = path.join(extensionDir, "store");
const size = { width: 1280, height: 800 };

let context: BrowserContext;
let worker: Worker;
let extensionId = "";

// ── Made-up sites ───────────────────────────────────────────────────────────────────

type Site = {
	brand: string;
	color: string;
	heading: string;
	lead: string;
	body: string;
};

const site = ({ brand, color, heading, lead, body }: Site) => `<!doctype html>
<title>${brand}</title>
<style>
	* { box-sizing: border-box; }
	body { margin: 0; min-height: 100vh; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
		color: #1d2433; background: #f4f6fa; display: flex; flex-direction: column; }
	header { display: flex; align-items: center; gap: 10px; padding: 18px 32px; background: #fff;
		border-bottom: 1px solid #e3e7ef; font-weight: 600; font-size: 17px; }
	.mark { width: 28px; height: 28px; border-radius: 7px; background: ${color}; color: #fff;
		display: grid; place-items: center; font-size: 15px; }
	nav { margin-left: auto; display: flex; gap: 24px; font-weight: 400; font-size: 14px; color: #5b6475; }
	main { flex: 1; display: grid; place-items: center; padding: 40px; }
	.card { width: 400px; background: #fff; border: 1px solid #e3e7ef; border-radius: 14px; padding: 32px;
		box-shadow: 0 8px 30px rgb(20 30 60 / 0.06); }
	h1 { font-size: 22px; margin: 0 0 6px; }
	p { margin: 0 0 22px; color: #5b6475; font-size: 14px; }
	label { display: block; font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
	input { width: 100%; height: 42px; border: 1px solid #cfd6e3; border-radius: 9px; padding: 0 12px; font: inherit; }
	button { width: 100%; height: 44px; margin-top: 22px; border: 0; border-radius: 9px; background: ${color};
		color: #fff; font: inherit; font-weight: 600; }
	.small { margin-top: 16px; font-size: 13px; text-align: center; color: #5b6475; }
	.tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; width: 880px; }
	.tile { background: #fff; border: 1px solid #e3e7ef; border-radius: 12px; padding: 20px; height: 120px; }
	.tile b { display: block; font-size: 26px; margin-top: 8px; }
</style>
<header><span class="mark">${brand[0]}</span>${brand}<nav><span>Product</span><span>Pricing</span><span>Help</span></nav></header>
<main>${body.replace("{heading}", heading).replace("{lead}", lead)}</main>`;

const signInCard = `<form class="card" onsubmit="event.preventDefault(); location.search = '?email=' + encodeURIComponent(this.email.value)">
	<h1>{heading}</h1><p>{lead}</p>
	<label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username">
	<label for="password">Password</label><input id="password" name="password" type="password">
	<button>Sign in</button>
	<div class="small">Forgot your password?</div>
</form>`;

const sites: Record<string, string> = {
	"bank.acme.test": site({
		brand: "Harbor Business Bank",
		color: "#0f6b5c",
		heading: "Sign in to online banking",
		lead: "Payments, payroll and statements for your company.",
		body: signInCard,
	}),
	"crm.acme.test": site({
		brand: "Pipeline CRM",
		color: "#c2410c",
		heading: "Welcome back",
		lead: "Sign in to your team's pipeline.",
		body: signInCard,
	}),
	"studio.acme.test": site({
		brand: "Northwind Studio",
		color: "#6d28d9",
		heading: "Sign in faster with a passkey",
		lead: "Use your password manager or this device instead of a password next time.",
		body: `<div class="card"><h1>{heading}</h1><p>{lead}</p>
			<button id="create">Create a passkey</button>
			<div class="small">Signed in as design@acme.test</div></div>
			<script>
				document.getElementById("create").onclick = () => navigator.credentials.create({ publicKey: {
					challenge: crypto.getRandomValues(new Uint8Array(32)),
					rp: { id: "studio.acme.test", name: "Northwind Studio" },
					user: { id: new TextEncoder().encode("design"), name: "design@acme.test", displayName: "Design" },
					pubKeyCredParams: [{ type: "public-key", alg: -7 }],
				} }).catch(() => {});
			</script>`,
	}),
	"deploy.acme.test": site({
		brand: "Skyline Deploy",
		color: "#1f5bf9",
		heading: "Two-step verification",
		lead: "Enter the six-digit code from your authenticator app.",
		body: `<div class="card"><h1>{heading}</h1><p>{lead}</p>
			<label for="code">Code</label><input id="code" inputmode="numeric" placeholder="123 456">
			<button>Verify</button></div>`,
	}),
};

const signedIn = (brand: string, color: string) =>
	site({
		brand,
		color,
		heading: "",
		lead: "",
		body: `<div class="tiles">${["Open deals", "Won this month", "Follow-ups"]
			.map(
				(label, i) =>
					`<div class="tile">${label}<b>${[42, 17, 9][i]}</b></div>`,
			)
			.join("")}</div>`,
	});

// ── The browser, the extension and the example team ─────────────────────────────────

test.beforeAll(async ({ request }) => {
	test.setTimeout(600_000);
	execFileSync("bun", ["run", "build"], { cwd: extensionDir, stdio: "ignore" });
	await resetWorkspace(request);

	context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		baseURL: `http://localhost:${WEB_PORT}`,
		viewport: size,
		deviceScaleFactor: 1,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
		],
	});
	worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent("serviceworker"));
	extensionId = new URL(worker.url()).host;
	await context.route(/^https:\/\/[a-z]+\.acme\.test\//, (route) => {
		const url = new URL(route.request().url());
		const page =
			url.searchParams.has("email") && url.hostname === "crm.acme.test"
				? signedIn("Pipeline CRM", "#c2410c")
				: sites[url.hostname];
		return page
			? route.fulfill({ contentType: "text/html", body: page })
			: route.abort();
	});

	const page = await context.newPage();
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
	await page.close();

	const popup = await openPopup();
	await popup.getByLabel("vauly address").fill(`http://localhost:${WEB_PORT}`);
	await popup.getByRole("button", { name: "Continue" }).click();
	await popup.getByLabel("Email").fill(owner.email);
	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Sign in" }).click();
	await expect(popup.getByRole("list", { name: "All items" })).toBeVisible();
	await popup.close();
});

test.afterAll(async () => {
	await context?.close();
});

async function openPopup(tabId?: number) {
	const popup = await context.newPage();
	await popup.setViewportSize({ width: 384, height: 600 });
	await popup.goto(
		`chrome-extension://${extensionId}/popup.html${tabId ? `?tab=${tabId}` : ""}`,
	);
	return popup;
}

async function tabIdOf(url: string) {
	type Tabs = { query(filter: { url: string }): Promise<{ id?: number }[]> };
	return worker.evaluate(
		async (pattern) =>
			(
				await (
					globalThis as unknown as { chrome: { tabs: Tabs } }
				).chrome.tabs.query({ url: pattern })
			)[0]?.id,
		`${url}/*`,
	);
}

async function openSite(host: string) {
	const page = await context.newPage();
	await page.goto(`https://${host}/`);
	return page;
}

/** Waits for logos and fonts, then a still picture of the page. */
async function still(page: Page) {
	await page.waitForLoadState("networkidle").catch(() => {});
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(500);
	return page.screenshot();
}

/**
 * The site's page with vauly's popup or window over it: the popup just under the
 * toolbar on the right, a window a little further in, both with the shadow Chrome
 * gives them.
 */
async function compose(
	name: string,
	background: Buffer,
	overlay: Buffer,
	place: { right: number; top: number; radius: number },
) {
	const scene = await context.newPage();
	await scene.setViewportSize(size);
	const url = (png: Buffer) =>
		`data:image/png;base64,${png.toString("base64")}`;
	await scene.setContent(`<style>
		html, body { margin: 0; width: ${size.width}px; height: ${size.height}px; overflow: hidden; }
		.page { position: absolute; inset: 0; width: 100%; height: 100%; }
		.over { position: absolute; right: ${place.right}px; top: ${place.top}px; border-radius: ${place.radius}px;
			box-shadow: 0 1px 2px rgb(0 0 0 / 0.18), 0 12px 40px rgb(15 23 42 / 0.28); }
	</style>
	<img class="page" src="${url(background)}"><img class="over" src="${url(overlay)}">`);
	await scene.evaluate(() =>
		Promise.all([...document.images].map((image) => image.decode())),
	);
	await scene.screenshot({ path: path.join(store, `${name}.png`) });
	await scene.close();
}

/**
 * The popup's own content, as tall as it is, plus `below` for its notice at the bottom.
 * Without the scrollbar a headless browser draws, which Chrome on a desktop overlays.
 */
async function popupPicture(
	popup: Page,
	below = 0,
	then: () => Promise<void> = async () => {},
) {
	await popup.addStyleTag({
		content:
			"* { scrollbar-width: none; } *::-webkit-scrollbar { display: none; }",
	});
	await popup.waitForLoadState("networkidle").catch(() => {});
	await popup.evaluate(() => document.fonts.ready);
	// Chrome sizes the popup to its body, which sets its own width.
	const width = await popup.evaluate(() =>
		Math.ceil(document.body.getBoundingClientRect().width),
	);
	const box = await popup.locator("#root > div").first().boundingBox();
	const height = Math.min(600, Math.ceil(box?.height ?? 600) + below);
	await popup.setViewportSize({ width, height });
	await then();
	await popup.waitForTimeout(600);
	return popup.screenshot();
}

// ── The pictures, in the store's order ──────────────────────────────────────────────

test("screenshot-1: the logins for the site you're on", async () => {
	const page = await openSite("bank.acme.test");
	const background = await still(page);
	const popup = await openPopup(await tabIdOf("https://bank.acme.test"));
	await expect(
		popup
			.getByRole("list", { name: "On bank.acme.test" })
			.getByText("Business bank"),
	).toBeVisible();
	await compose("screenshot-1", background, await popupPicture(popup), {
		right: 16,
		top: 8,
		radius: 10,
	});
	await popup.close();
	await page.close();
});

test("screenshot-2: the fill menu in a login field", async () => {
	const page = await openSite("bank.acme.test");
	const email = page.getByLabel("Email");
	await email.click();
	await expect(page.locator("vauly-button")).toHaveCount(1);
	const box = await email.boundingBox();
	if (!box) throw new Error("no email field");
	await page.mouse.click(box.x + box.width - 18, box.y + box.height / 2);
	await expect
		.poll(() =>
			page.frames().some((frame) => frame.url().includes("/inline.html")),
		)
		.toBe(true);
	const menu = page
		.frames()
		.find((frame) => frame.url().includes("/inline.html"));
	await menu
		?.getByRole("button", { name: "Fill Business bank, acme-finance" })
		.hover();
	await page.screenshot({ path: path.join(store, "screenshot-2.png") });
	await page.close();
});

test("screenshot-3: saving a login after signing in", async () => {
	const page = await openSite("crm.acme.test");
	await page.getByLabel("Email").fill("sales@acme.test");
	await page.getByLabel("Password").fill("Pl!9wQ4rTz7m");
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(/\?email=/);
	const tabId = await tabIdOf("https://crm.acme.test");
	const find = () =>
		context
			.pages()
			.find((other) => other.url().endsWith(`/save.html#${tabId}`));
	await expect.poll(() => Boolean(find())).toBe(true);
	const window = find() as Page;
	await window.setViewportSize({ width: 380, height: 300 });
	const offer = window.getByRole("region", { name: "Save login" });
	await expect(offer).toBeVisible();
	await offer.getByLabel("Name", { exact: true }).fill("Pipeline CRM");
	await window.evaluate(() => document.fonts.ready);
	const box = await offer.boundingBox();
	const picture = await window.screenshot({
		clip: {
			x: 0,
			y: 0,
			width: 380,
			height: Math.ceil((box?.y ?? 0) + (box?.height ?? 300) + 8),
		},
	});
	await compose("screenshot-3", await still(page), picture, {
		right: 24,
		top: 72,
		radius: 12,
	});
	await window.close();
	await page.close();
});

test("screenshot-4: a passkey, in vauly's own window", async () => {
	const page = await openSite("studio.acme.test");
	const background = await still(page);
	const [window] = await Promise.all([
		context.waitForEvent("page"),
		page.getByRole("button", { name: "Create a passkey" }).click(),
	]);
	await expect(window).toHaveURL(/\/passkey\.html#/);
	await window.setViewportSize({ width: 400, height: 380 });
	await expect(
		window.getByRole("heading", {
			name: "Save a passkey for studio.acme.test?",
		}),
	).toBeVisible();
	await window.evaluate(() => document.fonts.ready);
	await window.waitForTimeout(300);
	const picture = await window.screenshot();
	await compose("screenshot-4", background, picture, {
		right: 440,
		top: 120,
		radius: 12,
	});
	await window.close();
	await page.close();
});

test("screenshot-5: search, and a one-time code copied", async () => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const page = await openSite("deploy.acme.test");
	const background = await still(page);
	const popup = await openPopup(await tabIdOf("https://deploy.acme.test"));
	await popup.getByLabel("Search items").fill("stripe");
	const results = popup.getByRole("list", { name: "Results" });
	await expect(results.getByText("Stripe dashboard")).toBeVisible();
	const picture = await popupPicture(popup, 52, async () => {
		await popup
			.getByRole("button", { name: "Copy one-time code for Stripe dashboard" })
			.click();
		await expect(popup.getByText(/One-time code copied/)).toBeVisible();
	});
	await compose("screenshot-5", background, picture, {
		right: 16,
		top: 8,
		radius: 10,
	});
	await popup.close();
	await page.close();
});
