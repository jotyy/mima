import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	resetWorkspace,
} from "../tests/helpers";

const images = path.resolve(import.meta.dirname, "../../docs/images");

type Example = {
	kind: "Login" | "API key" | "SSH key";
	name: string;
	username?: string;
	secret: string;
	website?: string;
	totp?: string;
	tags?: string;
};

// An example team's Engineering vault. Every address is on a reserved test domain.
const engineering: Example[] = [
	{
		kind: "Login",
		name: "AWS root",
		username: "ops@acme.test",
		secret: "uT7#qLw2!Rz9vKe4",
		website: "console.aws.amazon.com",
		totp: "JBSWY3DPEHPK3PXP",
		tags: "cloud",
	},
	{
		kind: "API key",
		name: "Cloudflare API token",
		secret: "cf_9Lq2vR7Wm4xT8bN3kD1s",
	},
	{
		kind: "Login",
		name: "GitHub",
		username: "acme-bot",
		secret: "Gh!8nQ2r#Vx5mL7w",
		website: "github.com",
		tags: "source",
	},
	{
		kind: "API key",
		name: "Postgres staging",
		username: "app",
		secret: "postgres://app:h4Kq9vT2@db.staging.acme.test/app",
	},
	{
		kind: "Login",
		name: "Sentry",
		username: "ops@acme.test",
		secret: "Sn#4kW8q!Lz2vR6p",
		website: "sentry.io",
	},
	{
		kind: "API key",
		name: "Stripe live key",
		secret: "sk_live_51NxQ2vLr8KcT4mWpZ9",
	},
	{
		kind: "SSH key",
		name: "deploy@prod",
		username: "deploy",
		secret:
			"-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
	},
];

async function addItem(page: Page, item: Example) {
	await page
		.getByRole("button", { name: /^(New item|Add your first item)$/ })
		.first()
		.click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("tab", { name: item.kind, exact: true }).click();
	await dialog.getByLabel("Name", { exact: true }).fill(item.name);
	if (item.username) await dialog.getByLabel("Username").fill(item.username);
	const secret = {
		Login: "Password",
		"API key": "Value",
		"SSH key": "Private key",
	}[item.kind];
	await dialog.getByLabel(secret, { exact: true }).fill(item.secret);
	if (item.website) await dialog.getByLabel("Website").fill(item.website);
	if (item.totp) await dialog.getByLabel("One-time code").fill(item.totp);
	if (item.tags) await dialog.getByLabel("Tags").fill(item.tags);
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();
}

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
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Vaults" })
		.click();
	await page.getByRole("button", { name: "New vault" }).first().click();
	const vault = page.getByRole("dialog");
	await vault.getByLabel("Name").fill("Engineering");
	await vault
		.getByLabel("Description")
		.fill("Databases, cloud and deploy keys.");
	await vault.getByRole("button", { name: "Create vault" }).click();
	await expect(vault).toBeHidden();

	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Engineering" })
		.click();
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
