import { existsSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { vauly } from "./cli";
import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const SECRET = "postgres://app:example-only-not-real@db.staging/app";
let token = "";
let reference = "";

// The command checks the injected value itself and prints it, so the test sees both
// that it arrived and that vauly masked it in the output.
const check = [
	"sh",
	"-c",
	`test "$DATABASE_URL" = "${SECRET}" && echo MATCH; echo "value: $DATABASE_URL"`,
];

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Postgres staging");
	await form.getByLabel("Value").fill(SECRET);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();

	// Agents stay out of the way: the reference lives behind the item's menu.
	await expect(page.getByText(/^vauly:\/\/itm_/)).toHaveCount(0);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	await expect(use.getByText("No agents yet.")).toBeVisible();
	reference = (
		(await use.getByText(/^vauly:\/\/itm_/).textContent()) ?? ""
	).trim();
	await page.close();
});

test("creating an agent shows its token once", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await expect(page).toHaveTitle("Agents · vauly");
	await expect(page.getByText("No agents yet")).toBeVisible();
	await page.getByRole("button", { name: "New agent" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Claude Code");
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	token = /VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	expect(token).toMatch(/^vauly_agent_agt_/);
	await dialog.getByRole("button", { name: "I've stored it" }).click();
	await expect(
		page.getByRole("region", { name: "Agents" }).getByText("Claude Code"),
	).toBeVisible();
});

test("vauly run waits for approval, then injects the value without revealing it", async ({
	page,
}) => {
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	await run.waitForStderr("needs approval");

	await signIn(page, owner);
	const needs = page.getByRole("region", { name: "Needs you" });
	await expect(
		needs.getByText("Claude Code wants Postgres staging"),
	).toBeVisible();
	await needs.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByText("Allowed Claude Code once")).toBeVisible();

	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
	expect(run.stdout()).toContain("value: <hidden>");
	expect(run.stdout()).not.toContain(SECRET);
});

test("allow once means once: the next run asks again, and deny stops it", async ({
	page,
}) => {
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	await run.waitForStderr("needs approval");

	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "Claude Code wants Postgres staging",
	});
	await card.getByRole("button", { name: "Deny" }).click();

	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("denied");
	expect(run.stdout()).not.toContain("MATCH");
});

test("an item granted until revoked works without asking", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("tab", { name: "Until I revoke it" }).click();
	await dialog.getByRole("button", { name: "Grant access" }).click();
	await expect(
		page.getByText("Claude Code can use Postgres staging"),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Agents that can use it" }),
	).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Allow Claude Code" }),
	).toBeChecked();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
	expect(run.stderr()).not.toContain("needs approval");
});

test("pausing the agent stops its token right away", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("switch", { name: "Claude Code enabled" }).click();
	await expect(page.getByText("Claude Code is paused")).toBeVisible();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("paused");
});

test("a forged token is rejected", async () => {
	const forged = token.replace(/\.[0-9a-f]{48}\./, `.${"0".repeat(48)}.`);
	const run = vauly(["run", "--", "true"], {
		VAULY_TOKEN: forged,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("Unknown agent token");
});

test("a deleted item is out of reach for agents until it's restored", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("switch", { name: "Claude Code enabled" }).click();
	await expect(page.getByText("Claude Code is on")).toBeVisible();

	await openAllItems(page);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Delete item" }).click();
	const blocked = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await blocked.exit).toBe(1);
	expect(blocked.stderr()).toContain("doesn't exist or was deleted");

	// Restoring brings back the item with its grant, so the agent runs without asking.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByText("Restored Postgres staging")).toBeVisible();
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
});

test("a file reference asks for the files, and hands the command a private path", async ({
	page,
}) => {
	const cert = "-----BEGIN EXAMPLE CERT-----\nexample-ca-for-agents\n";
	await signIn(page, owner);
	await openAllItems(page);
	// An item of its own: a denial a minute ago holds the other one back for a while.
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Internal CA");
	await form.getByLabel("Value").fill("example-ca-key");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.getByLabel("File to attach").setInputFiles({
		name: "ca.pem",
		mimeType: "application/x-pem-file",
		buffer: Buffer.from(cert),
	});
	await expect(
		page.getByText("Attached ca.pem", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	const fileReference = (
		(await use.getByText(/\/files\/ca\.pem$/).textContent()) ?? ""
	).trim();
	expect(fileReference).toMatch(/^vauly:\/\/itm_[a-z0-9]+\/files\/ca\.pem$/);
	await page.keyboard.press("Escape");

	const run = vauly(
		[
			"run",
			"--",
			"sh",
			"-c",
			'echo "path: $CA_FILE"; ls -l "$CA_FILE"; cat "$CA_FILE"',
		],
		{ VAULY_TOKEN: token, CA_FILE: fileReference },
	);
	await run.waitForStderr("needs approval");
	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "Claude Code wants Internal CA",
	});
	await expect(
		card.getByText("and writes one of its files for the command"),
	).toBeVisible();
	await card.getByRole("button", { name: "Allow for 1 hour" }).click();

	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("example-ca-for-agents");
	expect(run.stdout()).toMatch(/-rw-------/);
	const path = /path: (\S+)/.exec(run.stdout())?.[1] ?? "";
	expect(path).toMatch(/ca\.pem$/);
	// The file goes when the command ends.
	expect(existsSync(path)).toBe(false);

	await sidebarLink(page, "Activity").click();
	await expect(
		page
			.getByRole("list", { name: "Events" })
			.getByText("downloaded ca.pem from")
			.first(),
	).toBeVisible();
});

test("the activity log shows each agent run and decision", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(events.getByText("injected").first()).toBeVisible();
	await expect(events.getByText("asked to use").first()).toBeVisible();
	await expect(events.getByText("denied Claude Code access to")).toBeVisible();
	await expect(events.getByText("let Claude Code use").first()).toBeVisible();
	await expect(events.getByText("created the agent")).toBeVisible();
});

test("an agent can be extended, and deleting it stops its token for good", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "Claude Code options" }).click();
	await page.getByRole("menuitem", { name: "Extend 7 days" }).click();
	await expect(page.getByText("Claude Code extended by 7 days")).toBeVisible();

	await page.getByRole("button", { name: "Claude Code options" }).click();
	await page.getByRole("menuitem", { name: "Delete agent" }).click();
	const confirm = page.getByRole("dialog");
	await expect(
		confirm.getByRole("heading", { name: "Delete Claude Code?" }),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Delete agent" }).click();
	await expect(page.getByText("Deleted Claude Code")).toBeVisible();
	await expect(page.getByText("No agents yet")).toBeVisible();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("Unknown agent token");
});
