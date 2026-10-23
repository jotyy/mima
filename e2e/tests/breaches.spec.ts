import { createHash } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

// Passwords found in data breaches, checked with Have I Been Pwned. A stand-in answers
// here: it knows one leaked password, and records what the browser asked it.

test.describe.configure({ mode: "serial" });
// The suite starts browsers with the check off; these tests want it on.
test.use({ storageState: { cookies: [], origins: [] } });

// Long and mixed, so vauly calls it strong; only the breach check catches it.
const LEAKED = "Summer-Holiday-2019!";
const sha1 = (text: string) =>
	createHash("sha1").update(text).digest("hex").toUpperCase();

type Asked = { path: string; padding?: string };

async function fakePwnedPasswords(context: BrowserContext) {
	const asked: Asked[] = [];
	await context.route("https://api.pwnedpasswords.com/range/*", (route) => {
		const url = new URL(route.request().url());
		asked.push({
			path: url.pathname,
			padding: route.request().headers()["add-padding"],
		});
		const prefix = url.pathname.split("/").pop() ?? "";
		const leaked = sha1(LEAKED);
		const lines = ["0018A45C4D1DEF81644B54AB7F969B88D65:0"];
		if (leaked.startsWith(prefix)) lines.push(`${leaked.slice(5)}:24`);
		return route.fulfill({
			contentType: "text/plain",
			headers: { "access-control-allow-origin": "*" },
			body: lines.join("\r\n"),
		});
	});
	return asked;
}

let asked: Asked[] = [];

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await fakePwnedPasswords(page.context());
	await createWorkspace(page);
	await openAllItems(page);
	await addLogin(page, "Old router", LEAKED);
	await addLogin(page, "GitHub", "copper-river-91!Q-harbor");
	await page.close();
});

test.beforeEach(async ({ context }) => {
	asked = await fakePwnedPasswords(context);
});

async function addLogin(page: Page, name: string, password: string) {
	await page.getByRole("button", { name: "New item" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill(name);
	await dialog.getByLabel("Password", { exact: true }).fill(password);
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();
}

function needs(page: Page) {
	return page.getByRole("region", { name: "Needs you" });
}

test("the overview points out a password found in data breaches", async ({
	page,
}) => {
	await signIn(page, owner);
	await expect(
		needs(page).getByText("Old router uses a password found in data breaches"),
	).toBeVisible();
	await expect(needs(page).getByText("has a weak password")).toHaveCount(0);

	// Only the first five characters of each password's SHA-1 left the browser.
	expect(asked.length).toBeGreaterThan(0);
	for (const { path, padding } of asked) {
		expect(path).toMatch(/^\/range\/[0-9A-F]{5}$/);
		expect(padding).toBe("true");
	}
});

test("a breached password is changed from its item", async ({ page }) => {
	await signIn(page, owner);
	await needs(page).getByRole("button", { name: "Change" }).click();
	await expect(page.getByRole("heading", { name: "Old router" })).toBeVisible();
	await expect(
		page.getByText("This password turned up 24 times in data breaches."),
	).toBeVisible();
	await expect(page.getByText("Leaked", { exact: true })).toBeVisible();
	await expect(page.getByText("Strong", { exact: true })).toHaveCount(0);

	await page.getByRole("button", { name: "Change" }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByText("Leaked: seen 24 times in data breaches"),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await expect(dialog.getByText("Strong", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByText(/in data breaches/)).toHaveCount(0);

	await sidebarLink(page, "Overview").click();
	await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("the editor warns about a leaked password before it's saved", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "New item" }).click();
	const dialog = page.getByRole("dialog");
	const password = dialog.getByLabel("Password", { exact: true });
	await password.fill(LEAKED);
	await expect(
		dialog.getByText("Leaked: seen 24 times in data breaches"),
	).toBeVisible();
	await password.fill(`${LEAKED} and more`);
	await expect(dialog.getByText("Strong", { exact: true })).toBeVisible();
	await expect(dialog.getByText(/Leaked/)).toHaveCount(0);
});

test("turned off on this device, nothing is asked", async ({ page }) => {
	await signIn(page, owner);
	await openUserMenu(page, owner.name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	const toggle = page.getByRole("switch", { name: "Breached passwords" });
	await toggle.click();
	await expect(toggle).not.toBeChecked();

	// A fresh unlock lists every login again, and nothing goes to the service.
	asked.length = 0;
	await page.reload();
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await openAllItems(page);
	await page.getByRole("button", { name: "New item" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Password", { exact: true }).fill(LEAKED);
	await expect(dialog.getByText("Strong", { exact: true })).toBeVisible();
	// The check waits for typing to pause; give it longer than that.
	await page.waitForTimeout(1000);
	await expect(dialog.getByText(/Leaked/)).toHaveCount(0);
	expect(asked).toEqual([]);
});
