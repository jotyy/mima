import { expect, test } from "@playwright/test";

import { mima } from "./cli";
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
// that it arrived and that mima masked it in the output.
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
	await expect(page.getByText(/^mima:\/\/itm_/)).toHaveCount(0);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	await expect(use.getByText("No agents yet.")).toBeVisible();
	reference = (
		(await use.getByText(/^mima:\/\/itm_/).textContent()) ?? ""
	).trim();
	await page.close();
});

test("creating an agent shows its token once", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await expect(page.getByText("No agents yet")).toBeVisible();
	await page.getByRole("button", { name: "New agent" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Claude Code");
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("MIMA_TOKEN=mima_agent_");
	token = /MIMA_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	expect(token).toMatch(/^mima_agent_agt_/);
	await dialog.getByRole("button", { name: "I've stored it" }).click();
	await expect(
		page.getByRole("region", { name: "Agents" }).getByText("Claude Code"),
	).toBeVisible();
});

test("mima run waits for approval, then injects the value without revealing it", async ({
	page,
}) => {
	const run = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
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
	const run = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
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

	const run = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
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

	const run = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("paused");
});

test("a forged token is rejected", async () => {
	const forged = token.replace(/\.[0-9a-f]{48}\./, `.${"0".repeat(48)}.`);
	const run = mima(["run", "--", "true"], {
		MIMA_TOKEN: forged,
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
	const blocked = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await blocked.exit).toBe(1);
	expect(blocked.stderr()).toContain("doesn't exist or was deleted");

	// Restoring brings back the item with its grant, so the agent runs without asking.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByText("Restored Postgres staging")).toBeVisible();
	const run = mima(["run", "--", ...check], {
		MIMA_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
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
