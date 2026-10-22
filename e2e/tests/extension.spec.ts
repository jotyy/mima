import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseTotp, totpCode } from "@mima/crypto";
import {
	type BrowserContext,
	chromium,
	expect,
	type Page,
	test,
	type Worker,
} from "@playwright/test";

import { WEB_PORT } from "../playwright.config";
import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
} from "./helpers";

// The browser extension, built and loaded into Chromium, against the e2e stack. A made-up
// site serves a login form so Fill has something to fill.

test.describe.configure({ mode: "serial" });

const extensionDir = path.resolve(import.meta.dirname, "../../apps/extension");
const extensionPath = path.join(extensionDir, ".output/chrome-mv3");
const site = "https://login.example.test";
const login = {
	name: "Example login",
	username: "alex@example.test",
	password: "example-fill-password-42",
	totp: "JBSWY3DPEHPK3PXP",
};
const loginPage = `<!doctype html>
<title>Example sign in</title>
<form>
	<label>Email <input type="email" name="email" autocomplete="username"></label>
	<label>Password <input type="password" name="password"></label>
	<button>Sign in</button>
</form>`;

let context: BrowserContext;
let worker: Worker | undefined;
let extensionId = "";

test.beforeAll(async ({ request }) => {
	execFileSync("bun", ["run", "build"], { cwd: extensionDir, stdio: "ignore" });
	await resetWorkspace(request);

	context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		baseURL: `http://localhost:${WEB_PORT}`,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
		],
	});
	[worker] = context.serviceWorkers();
	worker ??= await context.waitForEvent("serviceworker");
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	extensionId = new URL(worker.url()).host;
	// Every made-up site serves the same login form.
	await context.route("https://*.example.test/**", (route) =>
		route.fulfill({ contentType: "text/html", body: loginPage }),
	);

	const page = await context.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill(login.name);
	await form.getByLabel("Username").fill(login.username);
	await form.getByLabel("Password", { exact: true }).fill(login.password);
	await form.getByLabel("Website").fill(site);
	await form.getByLabel("One-time code").fill(login.totp);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await expect(
		page.getByRole("region", { name: "Items" }).getByText(login.name),
	).toBeVisible();
	await page.close();
});

test.afterAll(async () => {
	await context?.close();
});

/** Opens the popup as a page; with a tab, it acts on that tab like a real popup would. */
async function openPopup(tabId?: number) {
	const popup = await context.newPage();
	await popup.goto(
		`chrome-extension://${extensionId}/popup.html${tabId ? `?tab=${tabId}` : ""}`,
	);
	return popup;
}

/** The codes valid around now, so a code copied just before a 30-second boundary counts. */
async function validCodes() {
	const config = parseTotp(login.totp);
	if (!config) throw new Error("bad test secret");
	const now = Date.now();
	return Promise.all([totpCode(config, now), totpCode(config, now - 30_000)]);
}

async function tabIdOf(url: string) {
	// The extension's own service worker can look up tabs with the chrome API.
	type Tabs = { query(filter: { url: string }): Promise<{ id?: number }[]> };
	return worker?.evaluate(
		async (pattern) =>
			(
				await (
					globalThis as unknown as { chrome: { tabs: Tabs } }
				).chrome.tabs.query({
					url: pattern,
				})
			)[0]?.id,
		`${url}/*`,
	);
}

test("the extension connects from the web address and signs in", async () => {
	const popup = await openPopup();
	await expect(
		popup.getByRole("heading", { name: "Connect to mima" }),
	).toBeVisible();
	await popup.getByLabel("mima address").fill("nothing.example.test");
	await popup.getByRole("button", { name: "Continue" }).click();
	await expect(popup.getByRole("alert")).toContainText(
		"no mima at that address",
	);

	await popup.getByLabel("mima address").fill(`http://localhost:${WEB_PORT}`);
	await popup.getByRole("button", { name: "Continue" }).click();
	await expect(
		popup.getByRole("heading", { name: "Sign in to mima" }),
	).toBeVisible();
	await popup.getByLabel("Email").fill(owner.email);
	await popup.getByLabel("Master password").fill("not the right password");
	await popup.getByRole("button", { name: "Sign in" }).click();
	await expect(popup.getByRole("alert")).toContainText("don't match");

	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Sign in" }).click();
	await expect(
		popup.getByRole("list", { name: "All items" }).getByText(login.name),
	).toBeVisible();
	await popup.close();
});

test("Fill puts the username and password into the site's form", async () => {
	const page = await context.newPage();
	await page.goto(`${site}/`);
	const popup = await openPopup(await tabIdOf(site));

	const here = popup.getByRole("list", { name: "On login.example.test" });
	await expect(here.getByText(login.name)).toBeVisible();
	await here.getByRole("button", { name: `Fill ${login.name}` }).click();

	await expect(page.getByLabel("Email")).toHaveValue(login.username);
	await expect(page.getByLabel("Password")).toHaveValue(login.password);
	// Fill leaves the one-time code on the clipboard for the next step.
	const pasted = await page.evaluate(() => navigator.clipboard.readText());
	expect(await validCodes()).toContain(pasted);
	await page.close();
});

test("a login's one-time code can be copied from the popup", async () => {
	const popup = await openPopup();
	await popup
		.getByRole("button", { name: `Copy one-time code for ${login.name}` })
		.click();
	await expect(
		popup.getByText(/One-time code copied · \d+s left/),
	).toBeVisible();
	const copied = await popup.evaluate(() => navigator.clipboard.readText());
	expect(await validCodes()).toContain(copied);
	await popup.close();
});

test("search finds items, and other sites get nothing to fill", async () => {
	const page = await context.newPage();
	await page.goto("https://elsewhere.example.test/");
	const popup: Page = await openPopup(
		await tabIdOf("https://elsewhere.example.test"),
	);
	await expect(popup.getByText("Nothing saved for this site.")).toBeVisible();
	await popup.getByLabel("Search items").fill("example");
	const results = popup.getByRole("list", { name: "Results" });
	await expect(results.getByText(login.name)).toBeVisible();
	await expect(
		results.getByRole("button", { name: `Fill ${login.name}` }),
	).toHaveCount(0);
	await popup.close();
	await page.close();
});

test("Lock forgets the key until the master password is entered again", async () => {
	const popup = await openPopup();
	await popup.getByRole("button", { name: "Lock" }).click();
	await expect(
		popup.getByRole("heading", { name: "Unlock mima" }),
	).toBeVisible();
	await expect(popup.getByText(owner.email)).toBeVisible();
	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Unlock" }).click();
	await expect(
		popup.getByRole("list", { name: "All items" }).getByText(login.name),
	).toBeVisible();
	await popup.close();
});

test("the activity log shows the fill", async () => {
	const page = await context.newPage();
	await page.goto("/");
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock" }).click();
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Activity" })
		.click();
	await expect(
		page.getByRole("main").getByText("filled in").first(),
	).toBeVisible();
	await page.close();
});
