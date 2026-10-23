import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

// Weak and reused passwords are found on this device, since only it can read them.

test.describe.configure({ mode: "serial" });

const SHARED = "river-stone-copper-91!Q";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await addLogin(page, "GitHub", SHARED);
	await addLogin(page, "Figma", SHARED);
	await addLogin(page, "Old router", "password1");
	await page.close();
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

test("the overview points out weak and reused passwords", async ({ page }) => {
	await signIn(page, owner);
	await expect(
		needs(page).getByText("Old router has a weak password"),
	).toBeVisible();
	await expect(
		needs(page).getByText("Figma and GitHub share a password"),
	).toBeVisible();
});

test("a reused password can be reviewed and changed", async ({ page }) => {
	await signIn(page, owner);
	await needs(page).getByRole("button", { name: "Review" }).click();
	await expect(page).toHaveURL(/health=reused/);

	const list = page.getByRole("region", { name: "Items" });
	await expect(list.getByText("Passwords used more than once")).toBeVisible();
	await expect(list.getByText("Same password as GitHub")).toBeVisible();
	await expect(list.getByText("Same password as Figma")).toBeVisible();
	await expect(list.getByText("Old router")).toHaveCount(0);

	// The callout links to the other item.
	await list.getByRole("link", { name: /^Figma/ }).click();
	await expect(
		page.getByText("If one leaks, the other is open too."),
	).toBeVisible();
	await page.getByRole("link", { name: "GitHub", exact: true }).click();
	await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();

	await page.getByRole("button", { name: "Change" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();

	await expect(
		list.getByText("Every login has its own password now."),
	).toBeVisible();
	await list.getByRole("link", { name: "Show all" }).click();
	await expect(list.getByText("Old router")).toBeVisible();
	await expect(page).not.toHaveURL(/health=/);
});

test("a weak password opens straight from the overview", async ({ page }) => {
	await signIn(page, owner);
	await expect(needs(page).getByText("share a password")).toHaveCount(0);
	await needs(page).getByRole("button", { name: "Change" }).click();
	await expect(page.getByRole("heading", { name: "Old router" })).toBeVisible();
	await expect(page.getByText("Weak", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(dialog).toBeHidden();

	await sidebarLink(page, "Overview").click();
	await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});
