import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	expectSignedIn,
	openUserMenu,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

/**
 * A platform authenticator that verifies the person, the way Touch ID or Windows Hello
 * would, through the Chrome DevTools Protocol. `prf` says whether it can give a PRF output.
 */
async function addAuthenticator(page: Page, { prf = true } = {}) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			ctap2Version: "ctap2_1",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
			// Not in Playwright's protocol types yet.
			...({ hasPrf: prf } as object),
		},
	});
}

async function openSettings(page: Page) {
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

async function turnOn(page: Page, password = owner.password) {
	await page.getByRole("switch", { name: "Unlock with this device" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Master password").fill(password);
	await dialog.getByRole("button", { name: "Turn on" }).click();
	return dialog;
}

async function lock(page: Page) {
	await page.getByRole("button", { name: "Lock now" }).click();
	await expect(
		page.getByRole("heading", { name: `Unlock ${owner.workspace}` }),
	).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

test("a browser without a passkey on this device doesn't offer it", async ({
	page,
}) => {
	await signIn(page, owner);
	await openSettings(page);
	await expect(page.getByText("Lock after")).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toHaveCount(0);
});

test("a passkey without PRF is turned away", async ({ page }) => {
	await addAuthenticator(page, { prf: false });
	await signIn(page, owner);
	await openSettings(page);
	const dialog = await turnOn(page);
	await expect(dialog.getByRole("alert")).toContainText(
		"can't unlock vauly with a passkey",
	);
});

test("with a passkey, vauly unlocks without the master password", async ({
	page,
}) => {
	await addAuthenticator(page);
	await signIn(page, owner);
	await openSettings(page);

	const dialog = await turnOn(page, "not my master password");
	await expect(dialog.getByRole("alert")).toContainText(
		"not your master password",
	);
	await dialog.getByLabel("Master password").fill(owner.password);
	await dialog.getByRole("button", { name: "Turn on" }).click();
	await expect(
		page.getByText("This device unlocks with a passkey now"),
	).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toBeChecked();

	await lock(page);
	await page.getByRole("button", { name: "Unlock with passkey" }).click();
	await expectSignedIn(page);

	// A reload forgets the keys too; the passkey still opens them.
	await page.reload();
	await expect(
		page.getByRole("heading", { name: `Unlock ${owner.workspace}` }),
	).toBeVisible();
	await page.getByRole("button", { name: "Unlock with passkey" }).click();
	await expectSignedIn(page);

	// The master password works as well as ever.
	await lock(page);
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);

	await openSettings(page);
	await page.getByRole("switch", { name: "Unlock with this device" }).click();
	await expect(page.getByText("Unlocking with a passkey is off")).toBeVisible();
	await lock(page);
	await expect(
		page.getByRole("button", { name: "Unlock with passkey" }),
	).toHaveCount(0);
});

test("signing out forgets this device's copy", async ({ page }) => {
	await addAuthenticator(page);
	await signIn(page, owner);
	await openSettings(page);
	await turnOn(page);
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toBeChecked();

	await lock(page);
	await expect(
		page.getByRole("button", { name: "Unlock with passkey" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(page.getByLabel("Email")).toBeVisible();
	await signIn(page, owner);
	await lock(page);
	await expect(
		page.getByRole("button", { name: "Unlock with passkey" }),
	).toHaveCount(0);
});

test("a new master password drops this device's copy", async ({ page }) => {
	await addAuthenticator(page);
	await signIn(page, owner);
	await openSettings(page);
	await turnOn(page);
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toBeChecked();

	await page.getByRole("button", { name: "Change master password" }).click();
	const dialog = page.getByRole("dialog");
	const next = "violet anchor paper river 31";
	await dialog.getByLabel("Current master password").fill(owner.password);
	await dialog.getByLabel("New master password").fill(next);
	await dialog.getByLabel("Repeat the new one").fill(next);
	await dialog.getByRole("button", { name: "Change master password" }).click();
	await expect(page.getByText("Master password changed")).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).not.toBeChecked();
	await lock(page);
	await expect(
		page.getByRole("button", { name: "Unlock with passkey" }),
	).toHaveCount(0);
});
