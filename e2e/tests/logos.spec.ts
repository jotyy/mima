import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	openUserMenu,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

// Brand logos come from Brandfetch; here a stand-in answers, so the test doesn't depend
// on the network and can see exactly what was asked for.

test.describe.configure({ mode: "serial" });

// A 1×1 PNG.
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

async function fakeBrandfetch(page: Page) {
	const asked: string[] = [];
	await page.route("https://cdn.brandfetch.io/**", (route) => {
		asked.push(new URL(route.request().url()).pathname.split("/")[1] ?? "");
		return route.fulfill({ contentType: "image/png", body: PIXEL });
	});
	return asked;
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await fakeBrandfetch(page);
	await createWorkspace(page);
	await openAllItems(page);
	for (const [name, url] of [
		["GitHub", "https://github.com/login"],
		["Build server", "https://ci.acme.corp"],
		["Stripe live key", ""],
	] as const) {
		await page.getByRole("button", { name: "New item" }).click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Name", { exact: true }).fill(name);
		await dialog
			.getByLabel("Password", { exact: true })
			.fill("copper-river-91!Q");
		if (url) await dialog.getByLabel("Website").fill(url);
		await dialog.getByRole("button", { name: "Add item" }).click();
		await expect(dialog).toBeHidden();
	}
	await page.close();
});

function logos(page: Page) {
	return page
		.getByRole("region", { name: "Items" })
		.locator('img[src^="https://cdn.brandfetch.io/"]');
}

test("logins and well-known services show their brand's logo", async ({
	page,
}) => {
	const asked = await fakeBrandfetch(page);
	await signIn(page, owner);
	await openAllItems(page);
	await expect(logos(page)).toHaveCount(2);
	expect(asked).toContain("github.com");
	expect(asked).toContain("stripe.com");
	// A private network name never leaves the device.
	expect(asked.some((domain) => domain.includes("acme"))).toBe(false);
});

test("logos can be turned off on this device", async ({ page }) => {
	const asked = await fakeBrandfetch(page);
	await signIn(page, owner);
	await openUserMenu(page, owner.name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	const toggle = page.getByRole("switch", { name: "Website logos" });
	await expect(toggle).toBeChecked();
	await toggle.click();
	await expect(toggle).not.toBeChecked();

	asked.length = 0;
	await openAllItems(page);
	await expect(
		page.getByRole("region", { name: "Items" }).getByText("Stripe live key"),
	).toBeVisible();
	await expect(logos(page)).toHaveCount(0);
	expect(asked).toHaveLength(0);
});
