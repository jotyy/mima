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

test("before it's signed in, a login field offers to sign in to mima", async () => {
	const page = await context.newPage();
	await page.goto(`${site}/`);
	await page.getByLabel("Email").click();
	// Only the button shows on focus: the browser's own suggestions go under the field.
	const button = page.getByRole("button", { name: "Fill with mima" });
	await expect(button).toBeVisible();
	await expect(page.locator("mima-frame")).toHaveCount(0);
	await button.click();
	await expect(fillMenu(page).getByText("Sign in to mima")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(page.locator("mima-frame")).toHaveCount(0);
	// Leaving the field takes the button away.
	await page.mouse.click(600, 500);
	await expect(button).toHaveCount(0);
	await page.close();
});

/** mima's fill menu inside a site's page, and its save prompt. */
const fillMenu = (page: Page) =>
	page.frameLocator('iframe[title="mima: fill a login"]');
/** Focuses a login field and opens mima's menu from the button that shows up in it. */
async function openMenu(page: Page, field: string) {
	await page.getByLabel(field).click();
	await page.getByRole("button", { name: "Fill with mima" }).click();
}
const savePrompt = (page: Page) =>
	page.frameLocator('iframe[title="mima: save a login"]');

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

test("the menu under a login field fills the site's form", async () => {
	const page = await context.newPage();
	await page.goto(`${site}/`);
	await openMenu(page, "Password");
	const menu = fillMenu(page);
	await menu
		.getByRole("button", { name: `Fill ${login.name}, ${login.username}` })
		.click();
	await expect(page.getByLabel("Email")).toHaveValue(login.username);
	await expect(page.getByLabel("Password")).toHaveValue(login.password);
	await expect(menu.getByText("The one-time code is copied")).toBeVisible();
	await expect(page.locator("mima-frame")).toHaveCount(0);

	// Typing in by hand closes it.
	await openMenu(page, "Email");
	await expect(menu.getByRole("button", { name: /^Fill / })).toBeVisible();
	await page.getByLabel("Email").pressSequentially("x");
	await expect(page.locator("mima-frame")).toHaveCount(0);
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

test("locked, the menu offers to unlock, and shows the logins once unlocked", async () => {
	const popup = await openPopup();
	await popup.getByRole("button", { name: "Lock" }).click();
	const page = await context.newPage();
	await page.goto(`${site}/`);
	await openMenu(page, "Email");
	const menu = fillMenu(page);
	await expect(menu.getByText("mima is locked")).toBeVisible();

	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Unlock" }).click();
	await expect(
		menu.getByRole("button", { name: `Fill ${login.name}, ${login.username}` }),
	).toBeVisible();
	await popup.close();
	await page.close();
});

async function badgeOf(tabId: number | undefined) {
	type Action = { getBadgeText(details: { tabId?: number }): Promise<string> };
	return worker?.evaluate(
		(id) =>
			(
				globalThis as unknown as { chrome: { action: Action } }
			).chrome.action.getBadgeText({ tabId: id }),
		tabId,
	);
}

/** Signs in on one of the made-up sites, the way a person would. */
async function signInOnSite(url: string, username: string, password: string) {
	const page = await context.newPage();
	await page.goto(`${url}/`);
	await page.getByLabel("Email").fill(username);
	await page.getByLabel("Password").fill(password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(/\?email=/);
	return page;
}

test("a new login typed into a site is offered for saving", async () => {
	const url = "https://new.example.test";
	const page = await signInOnSite(url, "sam@example.test", "brand-new-pass-77");
	const tabId = await tabIdOf(url);
	await expect.poll(() => badgeOf(tabId)).toBe("1");

	const popup = await openPopup(tabId);
	const offer = popup.getByRole("region", { name: "Save login" });
	await expect(
		offer.getByText("You just signed in on new.example.test."),
	).toBeVisible();
	await expect(offer.getByLabel("Username")).toHaveValue("sam@example.test");
	await offer.getByLabel("Name", { exact: true }).fill("New site");
	await offer.getByRole("button", { name: "Save" }).click();
	await expect(popup.getByText("Saved to Private")).toBeVisible();
	await expect(offer).toHaveCount(0);
	await expect(
		popup
			.getByRole("list", { name: "On new.example.test" })
			.getByText("New site"),
	).toBeVisible();
	expect(await badgeOf(tabId)).toBe("");
	await popup.close();
	await page.close();
});

test("a new login is offered for saving right on the site", async () => {
	const url = "https://shop.example.test";
	const page = await signInOnSite(url, "kim@example.test", "shop-pass-2024");
	const prompt = savePrompt(page);
	const offer = prompt.getByRole("region", { name: "Save login" });
	await expect(
		offer.getByText("You just signed in on shop.example.test."),
	).toBeVisible();
	await expect(offer.getByLabel("Username")).toHaveValue("kim@example.test");
	await offer.getByLabel("Name", { exact: true }).fill("Shop");
	await offer.getByRole("button", { name: "Save" }).click();
	await expect(prompt.getByText("Saved to Private")).toBeVisible();
	await expect(page.locator("mima-frame")).toHaveCount(0);
	expect(await badgeOf(await tabIdOf(url))).toBe("");

	// Next time, the menu has it.
	await openMenu(page, "Email");
	await expect(
		fillMenu(page).getByRole("button", { name: "Fill Shop, kim@example.test" }),
	).toBeVisible();
	await page.close();
});

test("a login that's saved already isn't offered again", async () => {
	const url = "https://new.example.test";
	const page = await signInOnSite(url, "sam@example.test", "brand-new-pass-77");
	const popup = await openPopup(await tabIdOf(url));
	await expect(
		popup
			.getByRole("list", { name: "On new.example.test" })
			.getByText("New site"),
	).toBeVisible();
	await expect(popup.getByRole("region", { name: "Save login" })).toHaveCount(
		0,
	);
	await expect(
		popup.getByRole("region", { name: "Update password" }),
	).toHaveCount(0);
	await popup.close();
	await page.close();
});

test("a changed password is offered as an update", async () => {
	const page = await signInOnSite(
		site,
		login.username,
		"example-fill-password-43",
	);
	const tabId = await tabIdOf(site);
	await expect.poll(() => badgeOf(tabId)).toBe("1");

	const popup = await openPopup(tabId);
	const offer = popup.getByRole("region", { name: "Update password" });
	await expect(
		offer.getByRole("heading", {
			name: `Update the password for ${login.name}?`,
		}),
	).toBeVisible();
	await offer.getByRole("button", { name: "Update" }).click();
	await expect(popup.getByText("Password updated")).toBeVisible();
	await popup.close();

	// Signing in again with the new password offers nothing.
	await page.close();
	const again = await signInOnSite(
		site,
		login.username,
		"example-fill-password-43",
	);
	const check = await openPopup(await tabIdOf(site));
	await expect(
		check.getByRole("list", { name: "On login.example.test" }),
	).toBeVisible();
	await expect(
		check.getByRole("region", { name: "Update password" }),
	).toHaveCount(0);
	await check.close();
	await again.close();
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

	// mima's own sign-in gets no menu, and the master password typed into it is never
	// offered for saving.
	await expect(page.locator("mima-frame")).toHaveCount(0);
	await page.waitForTimeout(500);
	const popup = await openPopup(await tabIdOf(`http://localhost:${WEB_PORT}`));
	await expect(popup.getByRole("list", { name: "All items" })).toBeVisible();
	await expect(popup.getByRole("region", { name: "Save login" })).toHaveCount(
		0,
	);
	await popup.close();
	await page.close();
});

test("with two-step login on, signing in asks for a code", async () => {
	const page = await context.newPage();
	await page.goto("/");
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock" }).click();
	await page.getByRole("button", { name: owner.name }).click();
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Turn on", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByTestId("setup-key")).toHaveText(/^[A-Z2-7]{32}$/);
	const key = (await dialog.getByTestId("setup-key").textContent()) ?? "";
	const config = parseTotp(key);
	if (!config) throw new Error("no setup key");
	await dialog.getByLabel("Code from the app").fill(await totpCode(config));
	await dialog.getByRole("button", { name: "Turn on" }).click();
	await dialog.getByRole("button", { name: "I saved them" }).click();
	await page.close();

	const popup = await openPopup();
	await popup.getByRole("button", { name: "Lock" }).click();
	await popup.getByRole("button", { name: "Use another account" }).click();
	await popup.getByLabel("Email").fill(owner.email);
	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Sign in" }).click();
	const code = popup.getByLabel("Code from your authenticator app");
	await expect(code).toBeVisible();
	// The code that turned it on is used up; the app's next one works.
	await code.fill(await totpCode(config, Date.now() + 30_000));
	await popup.getByRole("button", { name: "Sign in" }).click();
	await expect(
		popup.getByRole("list", { name: "All items" }).getByText(login.name),
	).toBeVisible();
	await popup.close();
});
