import { type Browser, expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openUserMenu,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

// Seeing where you're signed in, and ending sessions on other devices.

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

async function openSettings(page: Page) {
	await openUserMenu(page, owner.name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

/** Another browser, signed in and left on the Overview. */
async function otherDevice(browser: Browser) {
	const context = await browser.newContext();
	const page = await context.newPage();
	await signIn(page, owner);
	return page;
}

test("signing out everywhere else keeps only this browser", async ({
	page,
	browser,
}) => {
	const laptop = await otherDevice(browser);
	const phone = await otherDevice(browser);
	await signIn(page, owner);
	await openSettings(page);

	const sessions = page.getByTestId("session");
	// Setting up the workspace left sessions behind too: closing a tab doesn't sign out.
	await expect(sessions.nth(2)).toBeVisible();
	await expect(sessions.first()).toContainText("This browser");
	await page.getByRole("button", { name: "Sign out everywhere else" }).click();
	await expect(sessions).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Sign out everywhere else" }),
	).toHaveCount(0);

	// The other browsers find out on their next request and drop their keys.
	for (const device of [laptop, phone]) {
		await expect(device.getByText("You were signed out")).toBeVisible();
		await expect(device.getByRole("button", { name: "Sign in" })).toBeVisible();
		await device.context().close();
	}
});

test("one other device can be signed out on its own", async ({
	page,
	browser,
}) => {
	await signIn(page, owner);
	await openSettings(page);
	await page.getByRole("button", { name: "Sign out everywhere else" }).click();
	const sessions = page.getByTestId("session");
	await expect(sessions).toHaveCount(1);

	const laptop = await otherDevice(browser);
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Overview" })
		.click();
	await openSettings(page);
	await expect(sessions).toHaveCount(2);
	await expect(sessions.nth(1)).toContainText("Chrome on");
	await sessions
		.nth(1)
		.getByRole("button", { name: /^Sign out / })
		.click();
	await expect(sessions).toHaveCount(1);
	await expect(laptop.getByRole("button", { name: "Sign in" })).toBeVisible();
	await laptop.context().close();
});
