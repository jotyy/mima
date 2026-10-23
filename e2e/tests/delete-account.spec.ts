import { type Browser, expect, type Page, test } from "@playwright/test";
import { decodeAgentToken } from "@vauly/crypto";

import { API_URL } from "../playwright.config";
import {
	createWorkspace,
	expectSignedIn,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// Deleting your own account from Settings: a member who manages a vault of their own,
// the owner who hands the workspace over first, and the last person, whose account takes
// the workspace with it.

test.describe.configure({ mode: "serial" });

const third = {
	name: "Sam Ortiz",
	email: "sam@acme.test",
	password: "quiet maple harbor river 19",
};
let teammateToken = "";

async function invite(page: Page, browser: Browser, person: typeof third) {
	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(person.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const url = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.getByRole("button", { name: "Done" }).click();
	const joining = await browser.newPage();
	await joining.goto(url);
	await joining.getByLabel("Your name").fill(person.name);
	await joining.getByLabel("Master password").fill(person.password);
	await joining.getByLabel("Repeat it").fill(person.password);
	await joining
		.getByRole("button", { name: `Join ${owner.workspace}` })
		.click();
	await expectSignedIn(joining);
	return joining;
}

async function newVault(page: Page, name: string) {
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(name);
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function share(page: Page, vault: string, person: string) {
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: `${vault} options` }).click();
	await page.getByRole("menuitem", { name: "Manage access" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Give access" }).click();
	await expect(page.getByText(`${person} can open ${vault}`)).toBeVisible();
	await page.keyboard.press("Escape");
}

async function openDeletion(page: Page, name: string) {
	await openUserMenu(page, name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Delete my account…" }).click();
	return page.getByRole("dialog");
}

async function whoami(token: string) {
	const { agentId, secret } = decodeAgentToken(token);
	const response = await fetch(`${API_URL}/rpc/agent/whoami`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${agentId}.${secret}`,
		},
		body: JSON.stringify({ json: null }),
	});
	return response.status;
}

test.beforeAll(async ({ browser, request }) => {
	test.setTimeout(180_000);
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await newVault(page, "Engineering");
	const joined = await invite(page, browser, teammate);
	await share(page, "Engineering", teammate.name);

	// The teammate manages a vault of their own, which the owner can edit, and has an agent.
	await newVault(joined, "Design");
	await share(joined, "Design", owner.name);
	await sidebarLink(joined, "Agents").click();
	await joined.getByRole("button", { name: "New agent" }).first().click();
	const agentDialog = joined.getByRole("dialog");
	await agentDialog.getByLabel("Name").fill("Mei's laptop");
	await agentDialog.getByRole("button", { name: "Create agent" }).click();
	const env = agentDialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	teammateToken =
		/VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await joined.context().close();
	await page.context().close();
});

test("a member sees what happens to each vault before deleting their account", async ({
	page,
}) => {
	expect(await whoami(teammateToken)).toBe(200);
	await signIn(page, teammate);
	const dialog = await openDeletion(page, teammate.name);
	const plan = dialog.getByRole("list", { name: "What happens" });
	await expect(
		plan.getByText("Your private vault is deleted, with its 0 items."),
	).toBeVisible();
	await expect(
		plan.getByText("Engineering stays with the others."),
	).toBeVisible();
	await expect(
		plan.getByText(`Design stays, and ${owner.name} will manage it.`),
	).toBeVisible();
	await expect(
		plan.getByText("Your agent stops working and is deleted."),
	).toBeVisible();

	const remove = dialog.getByRole("button", { name: "Delete my account" });
	await expect(remove).toBeDisabled();
	await dialog.getByLabel("Master password").fill("not my master password");
	await dialog
		.getByLabel(`Type ${teammate.email} to confirm`)
		.fill(teammate.email);
	await remove.click();
	await expect(
		dialog.getByText("The current master password is wrong"),
	).toBeVisible();

	await dialog.getByLabel("Master password").fill(teammate.password);
	await remove.click();
	await expect(page.getByText("Your account was deleted")).toBeVisible();
	await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("after that they can't sign in, and their agent is gone", async ({
	page,
}) => {
	expect(await whoami(teammateToken)).toBe(401);
	await page.goto("/login");
	await page.getByLabel("Email").fill(teammate.email);
	await page.getByLabel("Master password").fill(teammate.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(
		page.getByRole("navigation").getByRole("link", { name: "Private" }),
	).toHaveCount(0);
});

test("the team keeps their vault, and the log says they left", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Design options" }).click();
	await expect(
		page.getByRole("menuitem", { name: "Manage access" }),
	).toBeVisible();
	await page.keyboard.press("Escape");

	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(
		events.getByText("deleted their account and left the workspace"),
	).toBeVisible();
	await expect(events.getByText(teammate.name).first()).toBeVisible();
	await expect(
		events.getByText(`changed what ${owner.name} can do in`),
	).toBeVisible();
});

test("the owner hands the workspace over before deleting their account", async ({
	page,
	browser,
}) => {
	await signIn(page, owner);
	const joined = await invite(page, browser, third);
	await joined.context().close();

	let dialog = await openDeletion(page, owner.name);
	await expect(
		dialog.getByRole("heading", { name: `Hand over ${owner.workspace} first` }),
	).toBeVisible();
	await dialog.getByRole("button", { name: "Go to Members" }).click();
	await page.getByRole("button", { name: `Manage ${third.name}` }).click();
	await page.getByRole("menuitem", { name: "Make owner" }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Make owner" })
		.click();
	await expect(
		page.getByText(`${third.name} owns the workspace now`),
	).toBeVisible();

	dialog = await openDeletion(page, owner.name);
	await expect(
		dialog.getByRole("heading", { name: "Delete your account?" }),
	).toBeVisible();
	await dialog.getByLabel("Master password").fill(owner.password);
	await dialog.getByLabel(`Type ${owner.email} to confirm`).fill(owner.email);
	await dialog.getByRole("button", { name: "Delete my account" }).click();
	await expect(page.getByText("Your account was deleted")).toBeVisible();
});

test("the last person's account takes the workspace with it", async ({
	page,
}) => {
	await signIn(page, third);
	const dialog = await openDeletion(page, third.name);
	await expect(
		dialog.getByRole("heading", {
			name: `Delete your account and ${owner.workspace}?`,
		}),
	).toBeVisible();
	await dialog.getByLabel("Master password").fill(third.password);
	await dialog
		.getByLabel(`Type ${owner.workspace} to confirm`)
		.fill(owner.workspace);
	await dialog.getByRole("button", { name: "Delete everything" }).click();
	await expect(
		page.getByRole("heading", { name: "Create your workspace" }),
	).toBeVisible();
});
