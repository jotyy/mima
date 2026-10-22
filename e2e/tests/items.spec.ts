import { expect, type Page, test } from "@playwright/test";

import {
	apiFromPage,
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

async function detail(page: Page) {
	return page
		.getByRole("main")
		.locator("section")
		.filter({ hasText: "Updated" })
		.first();
}

test("an empty vault offers to add the first item", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await expect(page.getByText("Nothing stored yet")).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add your first item" }),
	).toBeVisible();
});

test("add a login with a generated password and a one-time code", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();

	const dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("heading", { name: "New item" })).toBeVisible();
	await dialog.getByLabel("Name", { exact: true }).fill("GitHub");
	await dialog.getByLabel("Username").fill("alex-at-acme");
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await expect(dialog.getByText("Strong")).toBeVisible();
	await dialog.getByLabel("Website").fill("github.com");
	await dialog.getByLabel("One-time code").fill(TOTP_SECRET);
	await dialog.getByLabel("Tags").fill("source, work");
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();

	const card = await detail(page);
	await expect(card.getByRole("heading", { name: "GitHub" })).toBeVisible();
	await expect(card.getByText("alex-at-acme")).toBeVisible();
	await expect(card.getByRole("link", { name: "github.com" })).toHaveAttribute(
		"href",
		"https://github.com",
	);
	await expect(card.getByText(/^\d{3} \d{3}$/)).toBeVisible();
	await expect(card.getByText("work", { exact: true })).toBeVisible();
	// Agent details stay behind the menu until an agent can use the item.
	await expect(card.getByText(/^mima:\/\/itm_/)).toHaveCount(0);
	await expect(card.getByText("Agents that can use it")).toHaveCount(0);
});

test("the server only ever sees ciphertext", async ({ page }) => {
	await signIn(page, owner);
	const raw = await apiFromPage(page, "items/list");
	expect(raw).toContain("itm_");
	expect(raw).not.toContain("GitHub");
	expect(raw).not.toContain("alex-at-acme");
	expect(raw).not.toContain(TOTP_SECRET);
});

test("reveal and copy the password; the clipboard pill counts down", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	const card = await detail(page);
	await card.getByRole("button", { name: "Reveal password" }).click();
	const password = (
		(await card.locator("dd .font-mono").first().textContent()) ?? ""
	).trim();
	expect(password.length).toBe(20);

	await card.getByRole("button", { name: "Copy password" }).click();
	const pill = page.getByText("Copied password");
	await expect(pill).toBeVisible();
	await expect(page.getByRole("button", { name: "Clear now" })).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		password,
	);

	// The pill sits centered over the content column, not over the whole window.
	await page.waitForTimeout(500);
	const pillBox = await page
		.locator("[data-slot=toast-pill]")
		.first()
		.boundingBox();
	const titleBox = await page
		.getByRole("main")
		.getByRole("heading", { level: 1 })
		.boundingBox();
	expect(pillBox && titleBox).toBeTruthy();
	if (pillBox && titleBox) {
		const pillCenter = pillBox.x + pillBox.width / 2;
		const titleCenter = titleBox.x + titleBox.width / 2;
		expect(Math.abs(pillCenter - titleCenter)).toBeLessThan(2);
	}

	await page.getByRole("button", { name: "Clear now" }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("");
});

test("edit an item and mark it as a favorite", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	const card = await detail(page);
	await card.getByRole("button", { name: "Edit" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("GitHub (work)");
	await dialog.getByLabel("Notes").fill("Recovery codes are in the safe.");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();
	await expect(
		card.getByRole("heading", { name: "GitHub (work)" }),
	).toBeVisible();
	await expect(card.getByText("Recovery codes are in the safe.")).toBeVisible();

	await card.getByRole("button", { name: "Add to favorites" }).click();
	await expect(
		card.getByRole("button", { name: "Remove from favorites" }),
	).toBeVisible();
});

test("search finds items by name, username and tag", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	const search = page.getByLabel("Search items");
	await search.fill("acme");
	await expect(
		page.getByRole("region", { name: "Items" }).getByText("GitHub (work)"),
	).toBeVisible();
	await search.fill("work");
	await expect(
		page.getByRole("region", { name: "Items" }).getByText("GitHub (work)"),
	).toBeVisible();
	await search.fill("nothing-like-this");
	await expect(page.getByText("Nothing matches")).toBeVisible();
});

test("the command palette copies a password without opening the item", async ({
	page,
}) => {
	await signIn(page, owner);
	await page.keyboard.press("ControlOrMeta+k");
	const palette = page.getByRole("dialog");
	await palette
		.getByPlaceholder("Search items, vaults and pages")
		.fill("github");
	await expect(
		palette.getByRole("option", { name: /GitHub \(work\)/ }),
	).toBeVisible();
	await page.keyboard.press("ControlOrMeta+c");
	await expect(page.getByText("Copied password")).toBeVisible();
	expect(
		(await page.evaluate(() => navigator.clipboard.readText())).length,
	).toBe(20);
});

test("delete asks first, then the vault is empty again", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	const card = await detail(page);
	await card.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Delete item" }).click();
	const confirm = page.getByRole("dialog");
	await expect(
		confirm.getByRole("heading", { name: /Delete GitHub/ }),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Delete item" }).click();
	await expect(page.getByText("Nothing stored yet")).toBeVisible();
});
