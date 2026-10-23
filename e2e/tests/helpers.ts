import {
	type APIRequestContext,
	expect,
	type Locator,
	type Page,
} from "@playwright/test";

import { API_URL, RESET_TOKEN } from "../playwright.config";

export const owner = {
	workspace: "Acme",
	name: "Alex Kim",
	email: "alex@acme.test",
	password: "correct horse battery staple 42",
};

export const teammate = {
	name: "Mei Chen",
	email: "mei@acme.test",
	password: "blue lantern quiet harbor 77",
};

/** Wipes the e2e database. Only works against the e2e stack, which has the token. */
export async function resetWorkspace(request: APIRequestContext) {
	for (let attempt = 0; attempt < 30; attempt++) {
		const response = await request
			.post(`${API_URL}/__e2e/reset`, {
				headers: { "x-reset-token": RESET_TOKEN },
			})
			.catch(() => null);
		if (response?.ok()) return;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error(
		"The e2e stack did not accept a reset. Is it running with a reset token?",
	);
}

export async function createWorkspace(page: Page, person = owner) {
	await page.goto("/");
	await expect(
		page.getByRole("heading", { name: "Create your workspace" }),
	).toBeVisible();
	await page.getByLabel("Workspace name").fill(person.workspace);
	await page.getByLabel("Your name").fill(person.name);
	await page.getByLabel("Email").fill(person.email);
	await page.getByLabel("Master password").fill(person.password);
	await page.getByLabel("Repeat it").fill(person.password);
	await page.getByRole("button", { name: "Create workspace" }).click();
	await expectSignedIn(page);
}

export async function signIn(
	page: Page,
	person: { email: string; password: string },
) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(person.email);
	await page.getByLabel("Master password").fill(person.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await expectSignedIn(page);
}

export async function expectSignedIn(page: Page) {
	await expect(
		page.getByRole("navigation").getByRole("link", { name: "Private" }),
	).toBeVisible();
}

export async function openUserMenu(page: Page, name = owner.name) {
	await page.getByRole("button", { name }).click();
}

/** Calls the API from the page, so the request carries the session cookie. */
export async function apiFromPage(
	page: Page,
	path: string,
	json: unknown = null,
) {
	return page.evaluate(
		async ({ url, body }) => {
			const response = await fetch(url, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ json: body }),
			});
			return response.text();
		},
		{ url: `${API_URL}/rpc/${path}`, body: json },
	);
}

/** In-app navigation: a full page load would lock the vault, as it should. */
export async function openAllItems(page: Page) {
	await page
		.getByRole("navigation")
		.getByRole("link", { name: "All items" })
		.click();
}

/** A sidebar link by its label; links can carry a count, such as "Agents 2". */
export function sidebarLink(page: Page, name: string) {
	const label = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return page
		.getByRole("navigation")
		.getByRole("link", { name: new RegExp(`^${label}( \\d+)?$`) });
}

/** Fails when something inside sticks out sideways, like a long link widening a dialog. */
export async function expectNoSidewaysOverflow(locator: Locator) {
	const overflow = await locator.evaluate(
		(element) => element.scrollWidth - element.clientWidth,
	);
	expect(overflow, "content wider than its box").toBeLessThanOrEqual(1);
}
