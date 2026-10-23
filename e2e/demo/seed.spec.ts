import { randomBytes } from "node:crypto";
import {
	type APIRequestContext,
	type Browser,
	expect,
	type Page,
	test,
} from "@playwright/test";

import { DEMO_API } from "../demo.config";
import {
	addItem,
	addVault,
	engineering,
	finance,
	marketing,
	personal,
} from "../example-team";
import { expectSignedIn, sidebarLink } from "../tests/helpers";

function setting(name: string) {
	const value = process.env[name];
	if (!value) throw new Error(`Set ${name}: the demo's settings are needed`);
	return value;
}

// The account every visitor signs in with.
const alex = {
	workspace: "Acme",
	name: "Alex Kim",
	email: setting("VAULY_DEMO_EMAIL"),
	password: setting("VAULY_DEMO_PASSWORD"),
};

// Teammates who joined, each with access to some of the shared vaults. Nobody signs in
// as them again, so their master passwords are thrown away.
const team = [
	{
		name: "Mei Chen",
		email: "mei@acme.example",
		vaults: ["Engineering", "Finance"],
	},
	{
		name: "Sam Rivera",
		email: "sam@acme.example",
		vaults: ["Engineering", "Marketing"],
	},
	{ name: "Jordan Lee", email: "jordan@acme.example", vaults: ["Marketing"] },
];

async function demoRoute(request: APIRequestContext, route: string) {
	const response = await request.post(`${DEMO_API}/__demo/${route}`, {
		headers: { "x-demo-token": setting("VAULY_DEMO_TOKEN") },
	});
	expect(response.ok(), `${route}: ${await response.text()}`).toBe(true);
}

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

async function join(browser: Browser, url: string, name: string) {
	const page = await browser.newPage();
	const password = randomBytes(18).toString("base64url");
	await page.goto(url);
	await page.getByLabel("Your name").fill(name);
	await page.getByLabel("Master password").fill(password);
	await page.getByLabel("Repeat it").fill(password);
	await page.getByRole("button", { name: `Join ${alex.workspace}` }).click();
	await expectSignedIn(page);
	await page.close();
}

async function giveAccess(page: Page, person: (typeof team)[number]) {
	const joined = page
		.getByRole("region", { name: "Needs you" })
		.locator(":scope > *")
		.filter({ hasText: `${person.name} joined` });
	// The overview learns about the newcomer when it next loads the members.
	await expect(async () => {
		await sidebarLink(page, "Members").click();
		await sidebarLink(page, "Overview").click();
		await expect(joined).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 60_000 });
	await joined.getByRole("button", { name: "Give access" }).click();
	const dialog = page.getByRole("dialog");
	for (const vault of person.vaults)
		await dialog
			.locator("label")
			.filter({ hasText: vault })
			.getByRole("checkbox")
			.click();
	await dialog.getByRole("button", { name: "Save access" }).click();
	await expect(dialog).toBeHidden();
}

test("the demo's example team", async ({ page, browser, request }) => {
	await demoRoute(request, "wipe");

	await page.goto(`/setup?code=${setting("VAULY_SETUP_CODE")}`);
	await page.getByLabel("Workspace name").fill(alex.workspace);
	await page.getByLabel("Your name").fill(alex.name);
	await page.getByLabel("Email").fill(alex.email);
	await page.getByLabel("Master password").fill(alex.password);
	await page.getByLabel("Repeat it").fill(alex.password);
	await page.getByRole("button", { name: "Create workspace" }).click();
	await expectSignedIn(page);

	await sidebarLink(page, "Private").click();
	for (const item of personal) await addItem(page, item);
	await addVault(
		page,
		"Engineering",
		"Databases, cloud and deploy keys.",
		"Teal",
	);
	for (const item of engineering) await addItem(page, item);
	await addVault(
		page,
		"Marketing",
		"Social accounts, design tools, the newsletter.",
		"Violet",
	);
	for (const item of marketing) await addItem(page, item);
	await addVault(
		page,
		"Finance",
		"The bank, payments and the company card.",
		"Amber",
	);
	for (const item of finance) await addItem(page, item);

	for (const person of team) {
		await join(browser, await invite(page, person.email), person.name);
		await giveAccess(page, person);
	}
	// And one who hasn't joined yet.
	await invite(page, "priya@acme.example");

	await demoRoute(request, "snapshot");
});
