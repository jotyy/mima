import { expect, test } from "@playwright/test";

import { createWorkspace, owner, resetWorkspace, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

test("an empty install asks the first person to create the workspace", async ({
	page,
}) => {
	await page.goto("/");
	await expect(page).toHaveURL(/\/setup$/);
	await expect(
		page.getByText("Nobody can reset your master password"),
	).toBeVisible();

	// Typed text is readable: the field color and size come from the type scale.
	const field = page.getByLabel("Workspace name");
	await field.fill(owner.workspace);
	expect(await field.evaluate((el) => getComputedStyle(el).color)).toBe(
		"rgb(0, 0, 0)",
	);
	expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe(
		"13.5px",
	);

	// A short or guessable master password is refused before anything leaves the page.
	await page.getByLabel("Your name").fill(owner.name);
	await page.getByLabel("Email").fill(owner.email);
	await page.getByLabel("Master password").fill("short");
	await page.getByLabel("Repeat it").fill("short");
	await page.getByRole("button", { name: "Create workspace" }).click();
	await expect(page.getByRole("alert")).toContainText("at least 12 characters");
});

test("the owner creates the workspace and lands in it, unlocked", async ({
	page,
}) => {
	await createWorkspace(page);
	await expect(page.getByText(owner.workspace).first()).toBeVisible();
	// The private vault is created and encrypted on this device during setup.
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Private" })
		.click();
	await expect(
		page.getByRole("heading", { name: "Private", exact: true }),
	).toBeVisible();
	await expect(page.getByText("Only you can open this vault.")).toBeVisible();
});

test("setup is closed once the workspace has an owner", async ({ page }) => {
	await page.goto("/setup");
	await expect(page).toHaveURL(/\/login$/);
	await expect(
		page.getByRole("heading", { name: `Sign in to ${owner.workspace}` }),
	).toBeVisible();
});

test("a wrong master password does not sign in", async ({ page }) => {
	await page.goto("/login");
	await page.getByLabel("Email").fill(owner.email);
	await page
		.getByLabel("Master password")
		.fill("not the right password at all");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("alert")).toContainText("don't match");
});

test("an unknown email gets the same answer as a wrong password", async ({
	page,
}) => {
	await page.goto("/login");
	await page.getByLabel("Email").fill("nobody@acme.test");
	await page.getByLabel("Master password").fill("whatever it is, it is wrong");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("alert")).toContainText("don't match");
});

test("locking forgets the keys until the master password is entered again", async ({
	page,
}) => {
	await signIn(page, owner);
	await page.getByRole("button", { name: "Lock now" }).click();
	await expect(
		page.getByRole("heading", { name: `Unlock ${owner.workspace}` }),
	).toBeVisible();

	await page.getByLabel("Master password").fill("wrong master password");
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(page.getByRole("alert")).toContainText(
		"not the master password",
	);

	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(
		page.getByRole("navigation").getByRole("link", { name: "Private" }),
	).toBeVisible();
});

test("a reload locks the vault but keeps the session", async ({ page }) => {
	await signIn(page, owner);
	await page.reload();
	await expect(
		page.getByRole("heading", { name: `Unlock ${owner.workspace}` }),
	).toBeVisible();
	await expect(page.getByText(owner.email)).toBeVisible();
});

test("signing out returns to the sign-in page", async ({ page }) => {
	await signIn(page, owner);
	await page.getByRole("button", { name: owner.name }).click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await expect(
		page.getByRole("heading", { name: `Sign in to ${owner.workspace}` }),
	).toBeVisible();
	await page.goto("/items");
	await expect(page).toHaveURL(/\/login$/);
});
