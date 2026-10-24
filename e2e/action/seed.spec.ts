import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	resetWorkspace,
	sidebarLink,
} from "../tests/helpers";

// Seeds the test stack for .github/workflows/action.yml: a CI agent allowed one made-up
// item, and another item nobody allows. It writes the token, both references and the
// made-up value's SHA-256 to VAULY_ACTION_SEED, and never prints the value: the workflow
// checks that it's nowhere in the job's log.

const out = process.env.VAULY_ACTION_SEED ?? "";
/** The made-up value, which the workflow's second job also reads from this file. */
const madeUp = JSON.parse(
	readFileSync(new URL("made-up.json", import.meta.url), "utf8"),
) as { value: string };

async function addKey(page: Page, name: string, value: string) {
	await openAllItems(page);
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill(name);
	await form.getByLabel("Value").fill(value);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	return (
		(await page
			.getByRole("dialog")
			.getByText(/^vauly:\/\/itm_/)
			.textContent()) ?? ""
	).trim();
}

test("seed the action's test instance", async ({ page, request }) => {
	expect(out, "VAULY_ACTION_SEED names a folder").not.toBe("");
	await resetWorkspace(request);
	await createWorkspace(page);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "New agent" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("GitHub Actions");
	await dialog.getByRole("tab", { name: "CI job" }).click();
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	const token =
		/VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await page.keyboard.press("Escape");

	const reference = await addKey(page, "Deploy token", madeUp.value);
	const grant = page.getByRole("dialog");
	await grant.getByRole("tab", { name: "Until I revoke it" }).click();
	await grant.getByRole("button", { name: "Grant access" }).click();
	await expect(
		page.getByText("GitHub Actions can use Deploy token"),
	).toBeVisible();
	const other = await addKey(page, "Staging key", "made-up-unapproved-3k9w");
	await page.keyboard.press("Escape");

	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "token"), token);
	writeFileSync(join(out, "reference"), reference);
	writeFileSync(join(out, "other"), other);
	writeFileSync(
		join(out, "sha256"),
		createHash("sha256").update(madeUp.value).digest("hex"),
	);
});
