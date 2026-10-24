import { expect, type Page, test } from "@playwright/test";

import {
	apiFromPage,
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

// Fields of an item's own, hidden or not, and logins used on more than one website.

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const PIN = "4711-example";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

function detail(page: Page) {
	return page
		.getByRole("main")
		.locator("section")
		.filter({ hasText: "Updated" })
		.first();
}

test("a login keeps several websites and fields of its own", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("Bank");
	await form.getByLabel("Username").fill("alex-acme");
	await form.getByLabel("Password", { exact: true }).fill("copper-river-91!Q");
	await form.getByLabel("Website").fill("bank.example.test");
	await form.getByRole("button", { name: "Add another website" }).click();
	await form
		.getByLabel("Website 2", { exact: true })
		.fill("eu.bank.example.test");
	await form.getByRole("button", { name: "Add a field" }).click();
	await form.getByLabel("Field 1 name").fill("Account number");
	await form.getByLabel("Field 1 value").fill("12345678");
	await form.getByRole("button", { name: "Add a field" }).click();
	await form.getByLabel("Field 2 name").fill("PIN");
	await form.getByLabel("Field 2 value").fill(PIN);
	await form.getByRole("button", { name: "Hide field 2" }).click();
	await expect(form.getByLabel("Field 2 value")).toHaveAttribute(
		"type",
		"password",
	);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();

	const item = detail(page);
	await expect(
		item.getByRole("link", { name: "bank.example.test", exact: true }),
	).toHaveAttribute("href", "https://bank.example.test");
	await expect(
		item.getByRole("link", { name: "eu.bank.example.test" }),
	).toBeVisible();
	await expect(item.getByText("12345678")).toBeVisible();
	await expect(item.getByText(PIN)).toHaveCount(0);
	await item.getByRole("button", { name: "Reveal PIN" }).click();
	await expect(item.getByText(PIN)).toBeVisible();
});

test("a field without a name isn't saved", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("Nameless field");
	await form.getByRole("button", { name: "Add a field" }).click();
	await form.getByLabel("Field 1 value").fill("something");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form.getByRole("alert")).toHaveText(
		"Give each field a name, such as PIN.",
	);
});

test("search finds visible fields and every website, never a hidden value", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	const list = page.getByRole("region", { name: "Items" });
	const search = page.getByPlaceholder("Search items");
	await search.fill("12345678");
	await expect(list.getByText("Bank")).toBeVisible();
	await search.fill("eu.bank");
	await expect(list.getByText("Bank")).toBeVisible();
	await search.fill(PIN);
	await expect(list.getByText("Bank")).toHaveCount(0);
});

test("editing and moving the item keep its fields", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const vaultForm = page.getByRole("dialog");
	await vaultForm.getByLabel("Name").fill("Finance");
	await vaultForm.getByRole("button", { name: "Create vault" }).click();

	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: /^Bank/ })
		.click();
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	const form = page.getByRole("dialog");
	await expect(form.getByLabel("Website 2", { exact: true })).toHaveValue(
		"https://eu.bank.example.test",
	);
	await form.getByLabel("Name", { exact: true }).fill("Bank, main");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();

	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Finance" }).click();
	await expect(page.getByText("Moved to Finance")).toBeVisible();
	const item = detail(page);
	await expect(item.getByText("12345678")).toBeVisible();
	await expect(item.getByRole("button", { name: "Reveal PIN" })).toBeVisible();
	await expect(
		item.getByRole("link", { name: "eu.bank.example.test" }),
	).toBeVisible();
});

test("a share link carries the fields, the hidden one masked", async ({
	page,
	browser,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Share a link" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("button", { name: "Create link" }).click();
	const url = (
		(await dialog.getByTestId("share-link").textContent()) ?? ""
	).trim();
	await dialog.getByRole("button", { name: "Done" }).click();

	const guest = await (await browser.newContext()).newPage();
	await guest.goto(url);
	await guest.getByRole("button", { name: "Show the item" }).click();
	const card = guest.getByRole("region", { name: "Bank, main" });
	await expect(card.getByText("12345678")).toBeVisible();
	await expect(card.getByText(PIN)).toHaveCount(0);
	await card.getByRole("button", { name: "Reveal PIN" }).click();
	await expect(card.getByText(PIN)).toBeVisible();
	await guest.context().close();
});

test("the activity log names the field that was revealed", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	await expect(
		page.getByRole("list", { name: "Events" }).getByText("revealed the PIN of"),
	).toBeVisible();
});

test("the server gets a field's ID, never its label, and refuses a label", async ({
	page,
}) => {
	await signIn(page, owner);
	const { json: events } = JSON.parse(
		await apiFromPage(page, "events/list", {}),
	) as {
		json: { action: string; itemId: string | null; detail: string | null }[];
	};
	const reveal = events.find((event) => event.action === "revealed");
	expect(reveal?.detail).toMatch(/^field:[a-z0-9]{8}$/);
	expect(JSON.stringify(events)).not.toContain("PIN");

	const refused = await apiFromPage(page, "items/log", {
		id: reveal?.itemId,
		action: "revealed",
		field: "Recovery PIN",
	});
	expect(refused).toContain("BAD_REQUEST");
});
