import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, type Page, test } from "@playwright/test";

import {
	expectSignedIn,
	openAllItems,
	openUserMenu,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

// The password generator makes random characters or passphrases, and a new master
// password can be a suggested passphrase.

test.describe.configure({ mode: "serial" });

const wordlist = new Set(
	readFileSync(
		fileURLToPath(
			new URL("../../apps/web/src/lib/eff-large-wordlist.txt", import.meta.url),
		),
		"utf8",
	)
		.split("\n")
		.map((line) => line.split("\t")[1]),
);

/** The master password the workspace was created with: the suggested passphrase. */
let passphrase = "";

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

test("a new workspace can take a suggested passphrase as its master password", async ({
	page,
}) => {
	await page.goto("/");
	await page.getByLabel("Workspace name").fill(owner.workspace);
	await page.getByLabel("Your name").fill(owner.name);
	await page.getByLabel("Email").fill(owner.email);
	await page.getByRole("button", { name: "Suggest a passphrase" }).click();
	passphrase =
		(await page.getByTestId("suggested-passphrase").textContent()) ?? "";
	const words = passphrase.split("-");
	expect(words).toHaveLength(6);
	for (const word of words) expect(wordlist.has(word)).toBe(true);
	await expect(page.getByText("Six random words, 78 bits.")).toBeVisible();

	await page.getByRole("button", { name: "Use it" }).click();
	await expect(page.getByLabel("Master password")).toHaveValue(passphrase);
	await expect(page.getByLabel("Repeat it")).toHaveValue(passphrase);
	await expect(page.getByText("Strong", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Create workspace" }).click();
	await expectSignedIn(page);

	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await signIn(page, { email: owner.email, password: passphrase });
});

async function newLogin(page: Page) {
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	return page.getByRole("dialog", { name: "New item" });
}

test("the generator makes passphrases from the list and remembers how", async ({
	page,
}) => {
	await signIn(page, { email: owner.email, password: passphrase });
	let dialog = await newLogin(page);
	const password = dialog.getByLabel("Password", { exact: true });

	// Random characters, as before.
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await expect(password).toHaveValue(/^\S{20}$/);
	await expect(dialog.getByText(/^Strong · \d+ bits$/)).toBeVisible();

	// Words: six by default, from the list, joined with hyphens.
	await dialog.getByRole("button", { name: "Generator settings" }).click();
	const settings = page.getByRole("dialog", { name: "Generator settings" });
	await settings.getByRole("tab", { name: "Words" }).click();
	await expect(password).toHaveValue(/^[a-z]+(-[a-z]+){5}$/);
	for (const word of (await password.inputValue()).split("-")) {
		expect(wordlist.has(word)).toBe(true);
	}
	await expect(dialog.getByText("Strong · 78 bits")).toBeVisible();

	// Four words, spaces, a capital on each and a digit on one.
	await settings.getByRole("combobox", { name: "Words", exact: true }).click();
	await page.getByRole("option", { name: "4 words" }).click();
	await settings.getByRole("combobox", { name: "Between words" }).click();
	await page.getByRole("option", { name: "Spaces" }).click();
	await settings.getByRole("switch", { name: "Capital letters" }).click();
	await settings.getByRole("switch", { name: "A digit" }).click();
	await expect(password).toHaveValue(/^([A-Z][a-z]+\d? ){3}[A-Z][a-z]+\d?$/);
	expect((await password.inputValue()).match(/\d/g)).toHaveLength(1);
	await expect(
		dialog.getByText("Fair · 57 bits: longer is better"),
	).toBeVisible();
	await page.keyboard.press("Escape");

	// The device keeps the settings: a new item, after the page loads again, makes the
	// same kind.
	await page.goto("/");
	await page.getByLabel("Master password").fill(passphrase);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);
	dialog = await newLogin(page);
	await dialog.getByRole("button", { name: "Generate a password" }).click();
	await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue(
		/^([A-Z][a-z]+\d? ){3}[A-Z][a-z]+\d?$/,
	);
});
