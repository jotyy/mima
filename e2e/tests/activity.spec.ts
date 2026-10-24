import { expect, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

// Each item shows who used it, and the activity log can narrow down to one item.

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("GitHub");
	await form.getByLabel("Username").fill("alex-at-acme");
	await form.getByLabel("Password", { exact: true }).fill("copper-river-91!Q");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.close();
});

test("an item shows who used it, most recent first", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	const recent = page.getByRole("region", { name: "Recent activity" });
	const rows = recent.getByRole("listitem");
	// One at a time: each use is logged by a request of its own, which could otherwise
	// arrive in either order.
	await page.getByRole("button", { name: "Reveal password" }).click();
	await expect(rows).toHaveCount(2);
	await page.getByRole("button", { name: "Copy username" }).click();
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toContainText(`${owner.name} copied the username`);
	await expect(rows.nth(1)).toContainText(
		`${owner.name} revealed the password`,
	);
	await expect(rows.nth(2)).toContainText(`${owner.name} added`);
	// The item's own name goes without saying.
	await expect(recent.getByText("GitHub")).toHaveCount(0);
});

test("the activity log narrows down to one item", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Recent activity" })
		.getByRole("link", { name: "All activity" })
		.click();
	await expect(page).toHaveURL(/activity\?item=itm_/);
	const events = page.getByRole("list", { name: "Events" });
	await expect(events.getByRole("listitem")).toHaveCount(3);
	await expect(page.getByText("3 events")).toBeVisible();
	await expect(events.getByText("joined the workspace")).toHaveCount(0);

	await page.getByRole("link", { name: "Show everything" }).click();
	await expect(events.getByText("joined the workspace")).toBeVisible();
});
