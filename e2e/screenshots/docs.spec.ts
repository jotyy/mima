import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

import { addItem, addVault, engineering } from "../example-team";
import {
	createWorkspace,
	openAllItems,
	resetWorkspace,
} from "../tests/helpers";

const images = path.resolve(import.meta.dirname, "../../docs/images");

async function both(page: Page, name: string) {
	// Wait out the notifications from adding things.
	await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
		timeout: 20_000,
	});
	await page.mouse.move(0, 0);
	await page.emulateMedia({ colorScheme: "light" });
	await page.waitForTimeout(400);
	await page.screenshot({ path: path.join(images, `${name}.png`) });
	await page.emulateMedia({ colorScheme: "dark" });
	await page.waitForTimeout(400);
	await page.screenshot({ path: path.join(images, `${name}-dark.png`) });
	await page.emulateMedia({ colorScheme: "light" });
}

test("docs images", async ({ page, request }) => {
	test.setTimeout(240_000);
	await resetWorkspace(request);
	await createWorkspace(page);

	// A shared vault for the engineers.
	await addVault(page, "Engineering", "Databases, cloud and deploy keys.");
	for (const item of engineering) await addItem(page, item);

	await page
		.getByRole("region", { name: "Items" })
		.getByText("AWS root")
		.click();
	await expect(page.getByText(/^\d{3} \d{3}$/)).toBeVisible();
	await both(page, "items");

	await openAllItems(page);
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Overview" })
		.click();
	await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
	await both(page, "overview");
});
