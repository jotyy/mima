import { expect, type Page, test } from "@playwright/test";

import {
	apiFromPage,
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// What someone can do in a vault: view, edit or manage. The API enforces it; the app
// shows only what each person can do.

test.describe.configure({ mode: "serial" });

const SECRET = "postgres://app:example-only-not-real@db.internal/app";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Engineering");
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Postgres staging");
	await form.getByLabel("Value").fill(SECRET);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();

	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const inviteUrl = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.context().close();

	const joining = await browser.newPage();
	await joining.goto(inviteUrl);
	await joining.getByLabel("Your name").fill(teammate.name);
	await joining.getByLabel("Master password").fill(teammate.password);
	await joining.getByLabel("Repeat it").fill(teammate.password);
	await joining
		.getByRole("button", { name: `Join ${owner.workspace}` })
		.click();
	await expect(sidebarLink(joining, "Private")).toBeVisible();
	await joining.context().close();
});

async function openAccess(page: Page) {
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Engineering options" }).click();
	await page
		.getByRole("menuitem", { name: /^(Manage access|People)$/ })
		.click();
	return page.getByRole("dialog");
}

async function engineering(page: Page) {
	const vaults = JSON.parse(await apiFromPage(page, "vaults/list")).json as {
		id: string;
		members: { userId: string; name: string }[];
	}[];
	const vault = vaults.find((v) => v.members.length > 1) ?? vaults[0];
	const items = JSON.parse(await apiFromPage(page, "items/list")).json as {
		id: string;
		vaultId: string;
	}[];
	return {
		id: vault?.id ?? "",
		member: (name: string) =>
			vault?.members.find((m) => m.name === name)?.userId ?? "",
		itemId: items.find((i) => i.vaultId === vault?.id)?.id ?? "",
	};
}

test("a manager shares a vault so a teammate can only view it", async ({
	page,
}) => {
	await signIn(page, owner);
	const dialog = await openAccess(page);
	await dialog.getByRole("combobox", { name: "What they can do" }).click();
	await page.getByRole("option", { name: /^Can view/ }).click();
	await dialog.getByRole("button", { name: "Give access" }).click();
	await expect(
		page.getByText(`${teammate.name} can open Engineering`),
	).toBeVisible();
	await expect(
		dialog.getByRole("combobox", { name: `What ${teammate.name} can do` }),
	).toContainText("Can view");
	// The only manager can't hand that away.
	await expect(
		dialog.getByRole("combobox", { name: `What ${owner.name} can do` }),
	).toHaveCount(0);
	await expect(dialog.getByText("Can manage")).toBeVisible();
});

test("someone who can view opens items but can't change them", async ({
	page,
}) => {
	await signIn(page, teammate);
	await sidebarLink(page, "Engineering").click();
	await expect(
		page.getByRole("heading", { name: "Postgres staging" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Reveal value" }).click();
	await expect(page.getByText(SECRET)).toBeVisible();
	for (const name of ["Edit", "Share a link", "More actions", "New item"]) {
		await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
			0,
		);
	}

	const dialog = await openAccess(page);
	await expect(
		dialog.getByText("Only the vault's managers can change who can open it."),
	).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Remove" })).toHaveCount(0);
	await expect(dialog.getByRole("combobox")).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(page.getByText("View only")).toBeVisible();

	// The API says no, whatever the app shows.
	const vault = await engineering(page);
	expect(
		await apiFromPage(page, "items/remove", { id: vault.itemId }),
	).toContain("You can open this vault but not change it");
	expect(
		await apiFromPage(page, "vaults/unshare", {
			vaultId: vault.id,
			userId: vault.member(owner.name),
		}),
	).toContain("Only the vault's managers can do that");
});

test("a manager lets them edit, and the log says so", async ({ page }) => {
	await signIn(page, owner);
	const dialog = await openAccess(page);
	await dialog
		.getByRole("combobox", { name: `What ${teammate.name} can do` })
		.click();
	await page.getByRole("option", { name: /^Can edit/ }).click();
	await expect(
		dialog.getByRole("combobox", { name: `What ${teammate.name} can do` }),
	).toContainText("Can edit");
	await page.keyboard.press("Escape");

	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(
		events.getByText(`changed what ${teammate.name} can do in`),
	).toBeVisible();
});

test("someone who can edit changes items, but not who can open the vault", async ({
	page,
}) => {
	await signIn(page, teammate);
	await sidebarLink(page, "Engineering").click();
	await expect(
		page.getByRole("button", { name: "Edit", exact: true }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "New item" })).toBeVisible();

	const vault = await engineering(page);
	expect(
		await apiFromPage(page, "vaults/setRole", {
			vaultId: vault.id,
			userId: vault.member(teammate.name),
			role: "manage",
		}),
	).toContain("Only the vault's managers can do that");
});

test("a vault always keeps a manager", async ({ page }) => {
	await signIn(page, owner);
	const vault = await engineering(page);
	expect(
		await apiFromPage(page, "vaults/setRole", {
			vaultId: vault.id,
			userId: vault.member(owner.name),
			role: "edit",
		}),
	).toContain("Make someone else a manager of this vault first");
});

test("when a vault's only manager leaves the workspace, its editors take over", async ({
	page,
	browser,
}) => {
	// The teammate makes a vault of their own and lets the owner edit it.
	const other = await browser.newPage();
	await signIn(other, teammate);
	await sidebarLink(other, "Vaults").click();
	await other.getByRole("button", { name: "New vault" }).click();
	const form = other.getByRole("dialog");
	await form.getByLabel("Name").fill("Design");
	await form.getByRole("button", { name: "Create vault" }).click();
	await sidebarLink(other, "Vaults").click();
	await other.getByRole("button", { name: "Design options" }).click();
	await other.getByRole("menuitem", { name: "Manage access" }).click();
	await other
		.getByRole("dialog")
		.getByRole("button", { name: "Give access" })
		.click();
	await expect(other.getByText(`${owner.name} can open Design`)).toBeVisible();
	await other.context().close();

	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Design options" }).click();
	await expect(page.getByRole("menuitem", { name: "People" })).toBeVisible();
	await page.keyboard.press("Escape");

	await sidebarLink(page, "Members").click();
	await page.getByRole("button", { name: `Manage ${teammate.name}` }).click();
	await page.getByRole("menuitem", { name: "Remove" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(page.getByText(`${teammate.name} was removed`)).toBeVisible();

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Design options" }).click();
	await expect(
		page.getByRole("menuitem", { name: "Manage access" }),
	).toBeVisible();
	await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible();
});
