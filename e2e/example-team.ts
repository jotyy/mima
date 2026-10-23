import { expect, type Page } from "@playwright/test";

// An example team's items, for the docs' screenshots and the demo at demo.vauly.app.
// Every address is on a reserved test domain or a real service's own; no secret is real.

export type Example = {
	kind: "Login" | "API key" | "SSH key" | "Note";
	name: string;
	username?: string;
	secret?: string;
	website?: string;
	totp?: string;
	notes?: string;
	tags?: string;
};

export const engineering: Example[] = [
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

export const marketing: Example[] = [
	{
		kind: "Login",
		name: "Figma",
		username: "design@acme.test",
		secret: "Fg7!wQ2m#Rk9vLp4",
		website: "figma.com",
		tags: "design",
	},
	{
		kind: "Login",
		name: "Webflow",
		username: "design@acme.test",
		// The same password as Figma, so the Overview has a reused one to point out.
		secret: "Fg7!wQ2m#Rk9vLp4",
		website: "webflow.com",
	},
	{
		kind: "API key",
		name: "Mailchimp API key",
		secret: "mc_7d1e4b9a2f6c8e3d5b0a-us21",
	},
	{
		kind: "Login",
		name: "LinkedIn page",
		username: "social@acme.test",
		secret: "summer2024",
		website: "linkedin.com",
		tags: "social",
	},
];

export const finance: Example[] = [
	{
		kind: "Login",
		name: "Stripe dashboard",
		username: "finance@acme.test",
		secret: "St!6rP9q#Wm2xK8v",
		website: "dashboard.stripe.com",
		totp: "KRSXG5CTMVRXEZLU",
	},
	{
		kind: "Login",
		name: "Business bank",
		username: "acme-finance",
		secret: "Bk#3vT8w!Qn5mR2z",
		website: "bank.acme.test",
	},
	{
		kind: "Note",
		name: "Company card",
		notes:
			"Card ending 4242, expires 09/29. Kept by Mei; ask before using it for anything over $500.",
	},
];

export const personal: Example[] = [
	{
		kind: "Note",
		name: "Office Wi-Fi",
		notes: "Network: Acme-Office\nPassword: lantern-copper-91",
		tags: "office",
	},
	{
		kind: "Login",
		name: "Google Workspace",
		username: "alex@acme.example",
		secret: "Gw$5nL8q!Vr2kT7m",
		website: "admin.google.com",
	},
];

export async function addItem(page: Page, item: Example) {
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
		Note: "",
	}[item.kind];
	if (secret && item.secret)
		await dialog.getByLabel(secret, { exact: true }).fill(item.secret);
	if (item.website) await dialog.getByLabel("Website").fill(item.website);
	if (item.totp) await dialog.getByLabel("One-time code").fill(item.totp);
	if (item.notes) await dialog.getByLabel("Notes").fill(item.notes);
	if (item.tags) await dialog.getByLabel("Tags").fill(item.tags);
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();
}

/** Creates a shared vault and opens it, so the next items go into it. */
export async function addVault(
	page: Page,
	name: string,
	description: string,
	color?: "Blue" | "Teal" | "Amber" | "Violet",
) {
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "Vaults" })
		.click();
	await page.getByRole("button", { name: "New vault" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(name);
	await dialog.getByLabel("Description").fill(description);
	if (color) await dialog.getByRole("button", { name: color }).click();
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await expect(dialog).toBeHidden();
	await page.getByRole("navigation").getByRole("link", { name }).click();
}
