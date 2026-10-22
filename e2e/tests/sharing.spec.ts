import { expect, test } from "@playwright/test";

import {
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const SECRET = "postgres://app:example-only-not-real@db.internal/app";
let inviteUrl = "";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

test("the owner creates a shared vault and stores a secret in it", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Engineering");
	await dialog.getByLabel("Description").fill("Databases and cloud accounts");
	await dialog.getByRole("button", { name: "Teal" }).click();
	await dialog.getByRole("button", { name: "Create vault" }).click();

	await expect(
		page.getByRole("heading", { name: "Engineering", exact: true }),
	).toBeVisible();
	// Inside a vault, only that vault is the current page in the sidebar.
	const nav = page.getByRole("navigation");
	await expect(nav.getByRole("link", { name: "Engineering" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(
		nav.getByRole("link", { name: "All items" }),
	).not.toHaveAttribute("aria-current", "page");
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Postgres staging");
	await form.getByLabel("Value").fill(SECRET);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(
		page.getByRole("region", { name: "Items" }).getByText("Postgres staging"),
	).toBeVisible();
});

test("the owner invites a teammate and gets a one-time link", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const link = page.getByTestId("invite-link");
	await expect(link).toContainText("/join?token=");
	inviteUrl = ((await link.textContent()) ?? "").trim();
	await page.getByRole("button", { name: "Done" }).click();
	await expect(
		page.getByRole("region", { name: "Invites" }).getByText(teammate.email),
	).toBeVisible();
});

test("the teammate joins with the link and only sees their private vault", async ({
	page,
}) => {
	await page.goto(inviteUrl);
	await expect(
		page.getByRole("heading", { name: `Join ${owner.workspace}` }),
	).toBeVisible();
	await expect(
		page.getByText(`${owner.name} invited ${teammate.email}`),
	).toBeVisible();
	await page.getByLabel("Your name").fill(teammate.name);
	await page.getByLabel("Master password").fill(teammate.password);
	await page.getByLabel("Repeat it").fill(teammate.password);
	await page.getByRole("button", { name: `Join ${owner.workspace}` }).click();

	await expect(sidebarLink(page, "Private")).toBeVisible();
	await expect(sidebarLink(page, "Engineering")).toHaveCount(0);
});

test("an invite link works only once", async ({ page }) => {
	await page.goto(inviteUrl);
	await expect(
		page.getByRole("heading", { name: "This invite doesn't work" }),
	).toBeVisible();
});

test("the owner sees the newcomer under Needs you and gives them the vault", async ({
	page,
}) => {
	await signIn(page, owner);
	const needs = page.getByRole("region", { name: "Needs you" });
	await expect(needs.getByText(`${teammate.name} joined`)).toBeVisible();
	await needs.getByRole("button", { name: "Give access" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("checkbox").first().click();
	await dialog.getByRole("button", { name: "Save access" }).click();
	await expect(
		page.getByText(`${teammate.name} can open Engineering`),
	).toBeVisible();
	await expect(needs.getByText(`${teammate.name} joined`)).toHaveCount(0);
});

test("the teammate can now open and decrypt the shared item", async ({
	page,
}) => {
	await signIn(page, teammate);
	await sidebarLink(page, "Engineering").click();
	const card = page
		.getByRole("main")
		.locator("section")
		.filter({ hasText: "Updated" })
		.first();
	await expect(
		card.getByRole("heading", { name: "Postgres staging" }),
	).toBeVisible();
	await card.getByRole("button", { name: "Reveal value" }).click();
	await expect(card.getByText(SECRET)).toBeVisible();
});

test("the teammate can't see the owner's private items", async ({ page }) => {
	await signIn(page, teammate);
	await sidebarLink(page, "All items").click();
	const list = page.getByRole("region", { name: "Items" });
	await expect(list.getByText("Postgres staging")).toBeVisible();
	await expect(list.locator("a")).toHaveCount(1);
});

test("removing someone from a vault takes it away from them", async ({
	page,
	browser,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Engineering options" }).click();
	await page.getByRole("menuitem", { name: "Manage access" }).click();
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByText(teammate.email)).toBeVisible();
	await dialog.getByRole("button", { name: "Remove" }).click();
	await expect(
		page.getByText(`${teammate.name} can't open Engineering anymore`),
	).toBeVisible();

	const other = await browser.newPage();
	await signIn(other, teammate);
	await expect(sidebarLink(other, "Engineering")).toHaveCount(0);
	await other.close();
});

test("the audit log records the sharing", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(
		events.getByText(`gave ${teammate.name} access to`),
	).toBeVisible();
	await expect(events.getByText(`removed ${teammate.name} from`)).toBeVisible();
	await expect(events.getByText("joined the workspace").first()).toBeVisible();
	await expect(events.getByText("revealed the password of")).toBeVisible();
});
