import { type Browser, expect, type Page, test } from "@playwright/test";
import { parseTotp, totpCode } from "@vauly/crypto";

import {
	apiFromPage,
	createWorkspace,
	expectSignedIn,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	teammate,
} from "./helpers";

// Requiring two-step login: once an admin turns it on, everyone without it sets it up
// before they can open a vault, and the server refuses the rest, not only the app.

test.describe.configure({ mode: "serial" });

const newcomer = {
	name: "Sam Okafor",
	email: "sam@example.test",
	password: "example-newcomer-password-1",
};

// Signed in throughout, so the owner's codes are never asked for twice in one period.
let admin: Page;
let mei: Page;
let sam: Page;

async function codeFor(secret: string) {
	const config = parseTotp(secret);
	if (!config) throw new Error("bad setup key");
	return totpCode(config);
}

async function openSettings(page: Page, name: string) {
	await openUserMenu(page, name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

/** Scans, types the code and keeps the recovery codes, in the dialog that's open. */
async function finishSetup(page: Page) {
	const dialog = page.getByRole("dialog");
	await expect(dialog.getByTestId("setup-key")).toHaveText(/^[A-Z2-7]{32}$/);
	const key = (await dialog.getByTestId("setup-key").textContent()) ?? "";
	await dialog.getByLabel("Code from the app").fill(await codeFor(key));
	await dialog.getByRole("button", { name: "Turn on" }).click();
	await expect(
		dialog.getByRole("list", { name: "Recovery codes" }).getByRole("listitem"),
	).toHaveCount(10);
	await dialog.getByRole("button", { name: "I saved them" }).click();
}

async function invite(email: string) {
	await sidebarLink(admin, "Members").click();
	await admin.getByLabel("Email to invite").fill(email);
	await admin.getByRole("button", { name: "Invite" }).click();
	const link = admin.getByTestId("invite-link");
	await expect(link).toContainText("/join?token=");
	const url = ((await link.textContent()) ?? "").trim();
	await admin.getByRole("button", { name: "Done" }).click();
	return url;
}

async function join(
	browser: Browser,
	url: string,
	person: { name: string; password: string },
) {
	const page = await (await browser.newContext()).newPage();
	await page.goto(url);
	await page.getByLabel("Your name").fill(person.name);
	await page.getByLabel("Master password").fill(person.password);
	await page.getByLabel("Repeat it").fill(person.password);
	return page;
}

const setupScreen = (page: Page) =>
	page.getByRole("heading", { name: "Set up two-step login" });

async function unlock(page: Page, password: string) {
	await page.getByLabel("Master password").fill(password);
	await page.getByRole("button", { name: "Unlock" }).click();
	await expectSignedIn(page);
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	admin = await (await browser.newContext()).newPage();
	await createWorkspace(admin);
	mei = await join(browser, await invite(teammate.email), teammate);
	await mei.getByRole("button", { name: `Join ${owner.workspace}` }).click();
	await expectSignedIn(mei);
});

test.afterAll(async () => {
	for (const page of [admin, mei, sam]) await page?.context().close();
});

test("an admin needs two-step login before requiring it", async () => {
	await openSettings(admin, owner.name);
	const required = admin.getByRole("switch", {
		name: "Require two-step login",
	});
	await expect(required).toBeDisabled();
	await expect(
		admin.getByText("Turn on two-step login for yourself first"),
	).toBeVisible();
	// The server says the same to a call the app would never make.
	expect(
		await apiFromPage(admin, "members/setTwoStepPolicy", { required: true }),
	).toContain("Turn on two-step login for yourself first");

	await admin.getByRole("button", { name: "Turn on", exact: true }).click();
	await finishSetup(admin);
	await expect(required).toBeEnabled();
});

test("turning it on says who it holds up, and Members marks them", async () => {
	await admin.getByRole("switch", { name: "Require two-step login" }).click();
	const dialog = admin.getByRole("dialog");
	await expect(dialog).toContainText(
		`1 member doesn't have it yet: ${teammate.name}.`,
	);
	await dialog.getByRole("button", { name: "Require it" }).click();
	await expect(admin.getByText("Two-step login is required")).toBeVisible();
	await expect(
		admin.getByRole("switch", { name: "Require two-step login" }),
	).toBeChecked();
	// It stays on for the admin while it's required: no way to turn it off here.
	await expect(
		admin.getByRole("button", { name: "Turn off", exact: true }),
	).toHaveCount(0);

	await sidebarLink(admin, "Members").click();
	await expect(admin.getByText("Needs two-step login")).toHaveCount(1);
});

test("a member without it is sent to set it up, and the server refuses the rest", async ({
	browser,
}) => {
	// Signing in afresh leads there too.
	const fresh = await (await browser.newContext()).newPage();
	await fresh.goto("/login");
	await fresh.getByLabel("Email").fill(teammate.email);
	await fresh.getByLabel("Master password").fill(teammate.password);
	await fresh.getByRole("button", { name: "Sign in" }).click();
	await expect(setupScreen(fresh)).toBeVisible();
	await fresh.context().close();

	await mei.reload();
	await expect(setupScreen(mei)).toBeVisible();
	// Still signed in, to set it up: this isn't a session that ended.
	await expect(mei.getByText("You were signed out")).toHaveCount(0);
	for (const path of ["vaults/list", "items/list", "members/list"]) {
		expect(await apiFromPage(mei, path), path).toContain("TWO_STEP_REQUIRED");
	}
	expect(await apiFromPage(mei, "account/me")).toContain(
		'"twoStepRequired":true',
	);
});

test("setting it up opens the vaults", async () => {
	await mei.getByRole("button", { name: "Set up two-step login" }).click();
	await finishSetup(mei);
	await unlock(mei, teammate.password);
	await expect(setupScreen(mei)).toHaveCount(0);
});

test("a reset sends them back to set it up, even with the app open", async () => {
	// Members loads afresh, now that Mei has it.
	await sidebarLink(admin, "Activity").click();
	await sidebarLink(admin, "Members").click();
	await expect(admin.getByText("Needs two-step login")).toHaveCount(0);
	await admin.getByRole("button", { name: `Manage ${teammate.name}` }).click();
	await admin.getByRole("menuitem", { name: "Reset two-step login" }).click();
	await admin
		.getByRole("dialog")
		.getByRole("button", { name: "Reset" })
		.click();
	await expect(admin.getByText("Needs two-step login")).toHaveCount(1);

	// Mei's next request is refused, and the app shows why.
	await sidebarLink(mei, "Activity").click();
	await expect(setupScreen(mei)).toBeVisible();
	await expect(mei.getByText("You were signed out")).toHaveCount(0);
});

test("a new member hears about it as they join, then sets it up", async ({
	browser,
}) => {
	sam = await join(browser, await invite(newcomer.email), newcomer);
	await expect(
		sam.getByText(
			`${owner.workspace} requires two-step login, so you'll set it up next.`,
		),
	).toBeVisible();
	await sam.getByRole("button", { name: `Join ${owner.workspace}` }).click();
	await expect(setupScreen(sam)).toBeVisible();
});

test("turning it off lets members without it back in", async () => {
	await openSettings(admin, owner.name);
	await admin.getByRole("switch", { name: "Require two-step login" }).click();
	await expect(admin.getByText("Two-step login is optional")).toBeVisible();

	for (const [page, password] of [
		[mei, teammate.password],
		[sam, newcomer.password],
	] as const) {
		await page.reload();
		await unlock(page, password);
	}
});

test("the activity log has the policy and each setup", async () => {
	await sidebarLink(admin, "Activity").click();
	const events = admin.getByRole("main");
	await expect(
		events.getByText("required two-step login for everyone"),
	).toBeVisible();
	await expect(events.getByText("made two-step login optional")).toBeVisible();
	await expect(events.getByText("turned on two-step login")).toHaveCount(2);
	await expect(
		events.getByText(`reset two-step login for ${teammate.name}`),
	).toBeVisible();
});
