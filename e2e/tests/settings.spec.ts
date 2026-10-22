import { readFile } from "node:fs/promises";

import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	expectSignedIn,
	openAllItems,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const NEW_PASSWORD = "silver kettle morning drum 58";
const SECRET = "sk_example_not_a_real_key_123";

async function openSettings(page: Page, name = owner.name) {
	await openUserMenu(page, name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Stripe, live");
	await form.getByLabel("Value").fill(SECRET);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.close();
});

test("renaming yourself shows the new name in the app", async ({ page }) => {
	await signIn(page, owner);
	await openSettings(page);
	const name = page.getByRole("textbox", { name: "Name", exact: true });
	await expect(
		page.getByRole("button", { name: "Save" }).first(),
	).toBeDisabled();
	await name.fill("Alex K.");
	await name.press("Enter");
	await expect(page.getByText("Name saved")).toBeVisible();
	await expect(page.getByRole("button", { name: "Alex K." })).toBeVisible();
	await name.fill(owner.name);
	await name.press("Enter");
	await expect(page.getByRole("button", { name: owner.name })).toBeVisible();
});

test("the auto-lock time is kept on this device", async ({ page }) => {
	await signIn(page, owner);
	await openSettings(page);
	await page.getByRole("combobox", { name: "Lock after" }).click();
	await page.getByRole("option", { name: "5 minutes", exact: true }).click();
	await expect(page.getByText("mima now locks after 5 minutes")).toBeVisible();
	await expect(page.getByText(/Locks in 5 minutes/)).toBeVisible();

	// A reload locks the vault; the choice survives it.
	await page.reload();
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock" }).click();
	await expect(page.getByText(/Locks in 5 minutes/)).toBeVisible();
});

test("an admin renames the workspace", async ({ page }) => {
	await signIn(page, owner);
	await openSettings(page);
	await page.getByRole("textbox", { name: "Workspace name" }).fill("Acme Labs");
	await page.getByRole("textbox", { name: "Workspace name" }).press("Enter");
	await expect(page.getByText("Workspace renamed")).toBeVisible();

	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(
		page.getByRole("heading", { name: "Sign in to Acme Labs" }),
	).toBeVisible();
});

test("a backup needs the master password and holds every item", async ({
	page,
}) => {
	await signIn(page, owner);
	await openSettings(page);
	await page.getByRole("button", { name: "Download a backup" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Master password").fill("not the password at all");
	await dialog.getByRole("button", { name: "Download backup" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"not your master password",
	);

	await dialog.getByLabel("Master password").fill(owner.password);
	const [download] = await Promise.all([
		page.waitForEvent("download"),
		dialog.getByRole("button", { name: "Download backup" }).click(),
	]);
	expect(download.suggestedFilename()).toMatch(
		/^mima-backup-\d{4}-\d{2}-\d{2}\.csv$/,
	);
	const csv = await readFile((await download.path()) ?? "", "utf8");
	expect(csv.split("\n")[0]).toContain("login_password");
	expect(csv).toContain('"Stripe, live"');
	expect(csv).toContain(SECRET);
	await expect(page.getByText("Backup downloaded")).toBeVisible();

	await sidebarLink(page, "Activity").click();
	await expect(
		page.getByRole("main").getByText("downloaded a backup of"),
	).toBeVisible();
});

test("changing the master password keeps every item readable", async ({
	page,
}) => {
	await signIn(page, owner);
	await openSettings(page);
	await page.getByRole("button", { name: "Change master password" }).click();
	const dialog = page.getByRole("dialog");
	await dialog
		.getByLabel("Current master password")
		.fill("wrong but long enough");
	await dialog.getByLabel("New master password").fill(NEW_PASSWORD);
	await dialog.getByLabel("Repeat the new one").fill(NEW_PASSWORD);
	await dialog.getByRole("button", { name: "Change master password" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"current master password is wrong",
	);

	await dialog.getByLabel("Current master password").fill(owner.password);
	await dialog.getByLabel("Repeat the new one").fill("does not match it");
	await dialog.getByRole("button", { name: "Change master password" }).click();
	await expect(dialog.getByRole("alert")).toContainText("don't match");

	await dialog.getByLabel("Repeat the new one").fill(NEW_PASSWORD);
	await dialog.getByRole("button", { name: "Change master password" }).click();
	await expect(page.getByText("Master password changed")).toBeVisible();
	await expect(dialog).toBeHidden();

	// The old password no longer signs in; the new one does, and the item still opens.
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await page.getByLabel("Email").fill(owner.email);
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("alert")).toContainText("don't match");

	await signIn(page, { email: owner.email, password: NEW_PASSWORD });
	await expectSignedIn(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Reveal value" }).click();
	await expect(page.getByText(SECRET)).toBeVisible();
});
