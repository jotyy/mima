import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// Running the workspace: roles, invites that are taken back, people who leave, and
// vaults that are renamed or deleted.

test.describe.configure({ mode: "serial" });

async function invite(page: Page, email: string) {
	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(email);
	await page.getByRole("button", { name: "Invite" }).click();
	const link = page.getByTestId("invite-link");
	await expect(link).toContainText("/join?token=");
	const url = ((await link.textContent()) ?? "").trim();
	await page.getByRole("button", { name: "Done" }).click();
	return url;
}

async function signOut(page: Page, name: string) {
	await openUserMenu(page, name);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	const url = await invite(page, teammate.email);
	await signOut(page, owner.name);

	await page.goto(url);
	await page.getByLabel("Your name").fill(teammate.name);
	await page.getByLabel("Master password").fill(teammate.password);
	await page.getByLabel("Repeat it").fill(teammate.password);
	await page.getByRole("button", { name: `Join ${owner.workspace}` }).click();
	await expect(sidebarLink(page, "Private")).toBeVisible();
	await page.close();
});

test("members can't invite or manage people", async ({ page }) => {
	await signIn(page, teammate);
	await sidebarLink(page, "Members").click();
	const people = page.getByRole("region", { name: "People" });
	await expect(people.getByText(owner.name)).toBeVisible();
	await expect(page.getByLabel("Email to invite")).toHaveCount(0);
	await expect(page.getByRole("button", { name: /^Manage / })).toHaveCount(0);
});

test("making someone an admin lets them invite people", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Members").click();
	await page.getByRole("button", { name: `Manage ${teammate.name}` }).click();
	await page.getByRole("menuitem", { name: "Admin", exact: true }).click();
	await expect(page.getByText(`${teammate.name} is now admin`)).toBeVisible();
	await signOut(page, owner.name);

	await signIn(page, teammate);
	await sidebarLink(page, "Members").click();
	await expect(page.getByLabel("Email to invite")).toBeVisible();
	// The owner can't be managed, not even by an admin.
	await expect(
		page.getByRole("button", { name: `Manage ${owner.name}` }),
	).toHaveCount(0);
});

test("an invite that's cancelled stops working", async ({ page }) => {
	await signIn(page, owner);
	const url = await invite(page, "sam@example.test");
	const invites = page.getByRole("region", { name: "Invites" });
	await expect(invites.getByText("sam@example.test")).toBeVisible();
	await page
		.getByRole("button", { name: "Cancel invite for sam@example.test" })
		.click();
	await expect(invites.getByText("sam@example.test")).toHaveCount(0);
	await signOut(page, owner.name);

	await page.goto(url);
	await expect(
		page.getByRole("heading", { name: "This invite doesn't work" }),
	).toBeVisible();
});

test("a shared vault can be renamed, then deleted with its items", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	let dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Marketing");
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await expect(
		page.getByRole("heading", { name: "Marketing", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("Newsletter tool");
	await form.getByLabel("Password", { exact: true }).fill("example-pass-77");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Marketing options" }).click();
	await page.getByRole("menuitem", { name: "Rename" }).click();
	dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Brand");
	await dialog.getByRole("button", { name: "Save" }).click();
	await expect(sidebarLink(page, "Brand")).toBeVisible();
	await expect(sidebarLink(page, "Marketing")).toHaveCount(0);

	await page.getByRole("button", { name: "Brand options" }).click();
	await page.getByRole("menuitem", { name: "Delete vault" }).click();
	const confirm = page.getByRole("dialog");
	await expect(
		confirm.getByText("Its 1 item is deleted for everyone"),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Delete vault" }).click();
	await expect(sidebarLink(page, "Brand")).toHaveCount(0);

	// Its item went with it, and doesn't wait in Recently deleted either.
	await sidebarLink(page, "All items").click();
	await expect(page.getByText("Nothing stored yet")).toBeVisible();
	await expect(page.getByText("Newsletter tool")).toHaveCount(0);
	await expect(sidebarLink(page, "Recently deleted")).toHaveCount(0);
});

test("a removed person can't sign in anymore", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Members").click();
	await page.getByRole("button", { name: `Manage ${teammate.name}` }).click();
	await page.getByRole("menuitem", { name: "Remove" }).click();
	const confirm = page.getByRole("dialog");
	await expect(
		confirm.getByRole("heading", { name: `Remove ${teammate.name}?` }),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Remove" }).click();
	await expect(page.getByText(`${teammate.name} was removed`)).toBeVisible();
	await expect(
		page.getByRole("region", { name: "People" }).getByText(teammate.name),
	).toHaveCount(0);
	await signOut(page, owner.name);

	await page.getByLabel("Email").fill(teammate.email);
	await page.getByLabel("Master password").fill(teammate.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("alert")).toContainText("don't match");
});
