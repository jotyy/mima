import { type Browser, expect, type Page, test } from "@playwright/test";

import {
	apiFromPage,
	createWorkspace,
	expectNoSidewaysOverflow,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

// Share links: one item for someone outside the workspace, encrypted with a key that
// only travels in the link's #fragment.

test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const PASSWORD = "harbor-lantern-quiet-58";

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("Office Wi-Fi");
	await dialog.getByLabel("Username").fill("acme-guest");
	await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();
	await page.close();
});

async function createLink(page: Page, options: { once?: boolean } = {}) {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Share a link" }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "Share Office Wi-Fi by link" }),
	).toBeVisible();
	await dialog.getByRole("tab", { name: "1 hour" }).click();
	if (options.once)
		await dialog.getByRole("switch", { name: "Only one view" }).click();
	await dialog.getByRole("button", { name: "Create link" }).click();
	await expect(
		dialog.getByRole("heading", { name: "Your link is ready" }),
	).toBeVisible();
	await expectNoSidewaysOverflow(dialog);
	const url = ((await dialog.getByTestId("share-link").textContent()) ?? "")
		.trim()
		.replace(/^.*?\/s\//, "/s/");
	await dialog.getByRole("button", { name: "Done" }).click();
	return url;
}

/** Someone outside the workspace: a fresh browser without a session. */
async function stranger(browser: Browser) {
	const context = await browser.newContext();
	return context.newPage();
}

test("someone outside the workspace opens a shared login", async ({
	page,
	browser,
}) => {
	const url = await createLink(page);
	expect(url).toMatch(/^\/s\/lnk_\w+#[\w-]{43}$/);

	const guest = await stranger(browser);
	await guest.goto(url);
	await expect(
		guest.getByRole("heading", {
			name: `${owner.name} shared an item with you`,
		}),
	).toBeVisible();
	await expect(guest.getByText(`From ${owner.workspace}.`)).toBeVisible();
	await guest.getByRole("button", { name: "Show the item" }).click();

	const card = guest.getByRole("region", { name: "Office Wi-Fi" });
	await expect(card.getByText("acme-guest")).toBeVisible();
	await expect(card.getByText(PASSWORD)).toHaveCount(0);
	await card.getByRole("button", { name: "Reveal password" }).click();
	await expect(card.getByText(PASSWORD)).toBeVisible();

	// A link without a limit opens again.
	await guest.reload();
	await expect(
		guest.getByRole("button", { name: "Show the item" }),
	).toBeVisible();
	await guest.context().close();
});

test("the server never sees the item or the key", async ({ page }) => {
	await signIn(page, owner);
	const items = JSON.parse(await apiFromPage(page, "items/list"));
	const raw = await apiFromPage(page, "links/list", {
		itemId: items.json[0].id,
	});
	expect(raw).toContain("lnk_");
	expect(raw).not.toContain(PASSWORD);
	expect(raw).not.toContain("acme-guest");
});

test("a one-view link works once", async ({ page, browser }) => {
	const url = await createLink(page, { once: true });
	const guest = await stranger(browser);
	await guest.goto(url);
	await expect(guest.getByText(/Opens only once/)).toBeVisible();
	await guest.getByRole("button", { name: "Show the item" }).click();
	await expect(guest.getByText("acme-guest")).toBeVisible();

	await guest.reload();
	await expect(
		guest.getByRole("heading", { name: "This link doesn't work anymore" }),
	).toBeVisible();
	await guest.context().close();
});

test("a link without its key can't open the item", async ({
	page,
	browser,
}) => {
	const url = await createLink(page);
	const guest = await stranger(browser);
	await guest.goto(url.split("#")[0] ?? url);
	await expect(
		guest.getByRole("heading", { name: "This link is missing its key" }),
	).toBeVisible();
	await guest.context().close();
});

test("turning a link off stops it, and the log shows who opened what", async ({
	page,
	browser,
}) => {
	const url = await createLink(page);
	const links = page.getByRole("region", { name: "Shared links" });
	// The first link (opened twice) and the one without its key still work.
	await expect(links.getByRole("listitem")).toHaveCount(3);
	for (const left of [2, 1, 0]) {
		await links.getByRole("button", { name: "Turn off" }).first().click();
		await expect(links.getByRole("listitem")).toHaveCount(left);
	}
	await expect(links).toHaveCount(0);

	const guest = await stranger(browser);
	await guest.goto(url);
	await expect(
		guest.getByRole("heading", { name: "This link doesn't work anymore" }),
	).toBeVisible();
	await guest.context().close();

	await sidebarLink(page, "Activity").click();
	await expect(
		page.getByText("Someone with a link opened Office Wi-Fi").first(),
	).toBeVisible();
	await expect(
		page.getByText(`${owner.name} shared a link to Office Wi-Fi`).first(),
	).toBeVisible();
	await expect(
		page.getByText(`${owner.name} turned off a link to Office Wi-Fi`).first(),
	).toBeVisible();
});
