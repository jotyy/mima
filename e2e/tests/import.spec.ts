import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

// A Bitwarden export with made-up values: three logins, a note and a card vauly skips.
const bitwarden = [
	"folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp",
	"Work,1,login,GitHub,,,0,https://github.com,alex@example.test,example-pass-1,",
	"Work,,login,Linear,,,0,https://linear.app,alex@example.test,example-pass-2,",
	',,login,Router,"admin panel, ground floor",,0,192.168.1.1,admin,example-pass-3,',
	",,note,Office Wi-Fi,guest network: example-only,,0,,,,",
	",,card,Company card,,,0,,,,",
].join("\n");

async function chooseFile(page: Page, name: string, contents: string) {
	await page
		.getByRole("dialog")
		.getByLabel("CSV file")
		.setInputFiles({
			name,
			mimeType: "text/csv",
			buffer: Buffer.from(contents),
		});
}

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

test("an empty vault offers to import a CSV", async ({ page }) => {
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Import from a CSV" }).click();
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByRole("heading", { name: "Import items" }),
	).toBeVisible();
	await expect(dialog.getByText("Bitwarden", { exact: false })).toBeVisible();
});

test("a file that isn't a password export is turned away", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await chooseFile(page, "cities.csv", "city,country\nOslo,Norway");
	await expect(page.getByRole("alert")).toContainText("no password column");
});

test("a Bitwarden export is reviewed, then imported encrypted", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await chooseFile(page, "bitwarden_export.csv", bitwarden);

	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByText("Bitwarden export · 3 logins, 1 note"),
	).toBeVisible();
	const list = dialog.getByRole("list", { name: "Items to import" });
	await expect(list.getByRole("listitem")).toHaveCount(4);
	await expect(list.getByText("Office Wi-Fi")).toBeVisible();
	await expect(dialog.getByText("1 row with no password")).toBeVisible();

	await dialog.getByRole("button", { name: "Import 4 items" }).click();
	await expect(page.getByText("Imported 4 items into Private")).toBeVisible();
	await expect(dialog).toBeHidden();

	const items = page.getByRole("region", { name: "Items" });
	await expect(items.getByRole("link")).toHaveCount(4);
	await items.getByRole("link", { name: /^Router/ }).click();
	const detail = page.getByRole("main").locator("section").filter({
		hasText: "Updated",
	});
	await expect(detail.getByText("admin", { exact: true })).toBeVisible();
	await expect(
		detail.getByRole("link", { name: "192.168.1.1" }),
	).toHaveAttribute("href", "https://192.168.1.1");
	await expect(detail.getByText("admin panel, ground floor")).toBeVisible();
});

test("importing the same file again leaves out what's already there", async ({
	page,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "Import", exact: true }).click();
	await chooseFile(page, "bitwarden_export.csv", bitwarden);
	const dialog = page.getByRole("dialog");
	await expect(
		dialog.getByText("4 items already in this vault are left out."),
	).toBeVisible();
	await expect(
		dialog.getByRole("button", { name: "Import 0 items" }),
	).toBeDisabled();
});

test("the activity log records one import, not one row per item", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("main");
	await expect(events.getByText("imported")).toHaveCount(1);
	await expect(events.getByText("4 items")).toBeVisible();
});
