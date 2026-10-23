import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// When someone loses access to a shared vault, the passwords they could see should
// change. mima points at the ones that haven't.

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Engineering");
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await expect(
		page.getByRole("heading", { name: "Engineering", exact: true }),
	).toBeVisible();
	await addLogin(page, "AWS root", "copper-lantern-river-81!");
	await addLogin(page, "Grafana", "quiet-harbor-stone-62!");

	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const link = page.getByTestId("invite-link");
	await expect(link).toContainText("/join?token=");
	const url = ((await link.textContent()) ?? "").trim();
	await page.getByRole("button", { name: "Done" }).click();
	await page.close();

	const joining = await browser.newPage();
	await joining.goto(url);
	await joining.getByLabel("Your name").fill(teammate.name);
	await joining.getByLabel("Master password").fill(teammate.password);
	await joining.getByLabel("Repeat it").fill(teammate.password);
	await joining
		.getByRole("button", { name: `Join ${owner.workspace}` })
		.click();
	await expect(sidebarLink(joining, "Private")).toBeVisible();
	await joining.close();
});

async function addLogin(page: Page, name: string, password: string) {
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill(name);
	await form.getByLabel("Password", { exact: true }).fill(password);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
}

function needs(page: Page) {
	return page.getByRole("region", { name: "Needs you" });
}

async function giveAccess(page: Page) {
	await needs(page).getByRole("button", { name: "Give access" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("checkbox").first().click();
	await dialog.getByRole("button", { name: "Save access" }).click();
	await expect(
		page.getByText(`${teammate.name} can open Engineering`),
	).toBeVisible();
}

test("removing someone from a vault points at what they could see", async ({
	page,
}) => {
	await signIn(page, owner);
	await giveAccess(page);

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Engineering options" }).click();
	await page.getByRole("menuitem", { name: "Manage access" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(
		page.getByText(`${teammate.name} can't open Engineering anymore`),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await sidebarLink(page, "Overview").click();
	await expect(
		needs(page).getByText(
			`${teammate.name} could see 2 items that haven't changed since`,
		),
	).toBeVisible();
	await needs(page).getByRole("button", { name: "Review" }).click();
	await expect(page).toHaveURL(/health=exposed/);

	const list = page.getByRole("region", { name: "Items" });
	await expect(list.getByText("Seen by people who lost access")).toBeVisible();
	await expect(list.getByText(`${teammate.name} could see it`)).toHaveCount(2);

	await list.getByRole("link", { name: /^AWS root/ }).click();
	await expect(
		page.getByText("could see this before losing access"),
	).toBeVisible();
	await page.getByRole("button", { name: "Change", exact: true }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("button", { name: "Generate a password" }).click();
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	await expect(list.getByText(`${teammate.name} could see it`)).toHaveCount(1);
	await expect(list.getByRole("link", { name: /^AWS root/ })).toHaveCount(0);
});

test("items added after they left don't count", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Engineering").click();
	await addLogin(page, "Sentry", "amber-kettle-morning-55!");
	await sidebarLink(page, "Overview").click();
	await expect(
		needs(page).getByText(
			`${teammate.name} could see 1 item that hasn't changed since`,
		),
	).toBeVisible();
});

test("Dismiss stops pointing at it", async ({ page }) => {
	await signIn(page, owner);
	const row = needs(page).getByRole("button", { name: "Dismiss" }).first();
	await row.click();
	await expect(needs(page)).toHaveCount(0);
	await expect(page.getByText("Nothing needs you right now.")).toBeVisible();
});

test("removing someone from the workspace counts too", async ({ page }) => {
	await signIn(page, owner);
	// Someone taken out of a vault on purpose isn't a newcomer waiting for access.
	await expect(
		needs(page).getByText(`${teammate.name} could see`),
	).toBeVisible();
	await expect(
		needs(page).getByText("can't open any shared vault"),
	).toHaveCount(0);
	await sidebarLink(page, "Members").click();
	await page.getByRole("button", { name: "Give access" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("checkbox").first().click();
	await dialog.getByRole("button", { name: "Save access" }).click();
	await expect(
		page.getByText(`${teammate.name} can open Engineering`),
	).toBeVisible();

	await page.getByRole("button", { name: `Manage ${teammate.name}` }).click();
	await page.getByRole("menuitem", { name: "Remove" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Remove" })
		.click();
	await expect(page.getByText(`${teammate.name} was removed`)).toBeVisible();

	await sidebarLink(page, "Overview").click();
	// Back in the vault, they saw AWS root's new password and Sentry too.
	await expect(
		needs(page).getByText(`${teammate.name} could see 3 items`),
	).toBeVisible();

	// Their account is gone, but the log still names them.
	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(
		events.getByText(`removed ${teammate.name} from the workspace`),
	).toBeVisible();
	await expect(
		events.getByText(`removed ${teammate.name} from`).first(),
	).toBeVisible();
	await expect(
		events.getByText(`gave ${teammate.name} access to`).first(),
	).toBeVisible();
});
