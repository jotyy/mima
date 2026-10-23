import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	openAllItems,
	openUserMenu,
	owner,
	resetWorkspace,
} from "./helpers";

// The built app is served with a strict Content-Security-Policy and can't be framed. Only
// the one-Worker run serves the build; the dev stack's Vite server sends no such headers.

test.skip(
	!process.env.VAULY_E2E_ONE_WORKER,
	"Only the built app is served with these headers.",
);
test.describe.configure({ mode: "serial" });
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

/** Collects what the policy refused, in every page of the context, popups too. */
function watchPolicy(context: BrowserContext) {
	const refused: string[] = [];
	const watch = (page: Page) =>
		page.on("console", (message) => {
			if (message.text().includes("Content Security Policy"))
				refused.push(message.text());
		});
	context.pages().forEach(watch);
	context.on("page", watch);
	return refused;
}

test("the app's pages and files are served with the security headers", async ({
	request,
}) => {
	for (const path of ["/", "/items", "/s/lnk_missing", "/registerSW.js"]) {
		const headers = (await request.get(path)).headers();
		const policy = headers["content-security-policy"] ?? "";
		expect(policy, path).toContain("script-src 'self';");
		expect(policy, path).toContain("frame-ancestors 'none'");
		expect(headers["x-frame-options"], path).toBe("DENY");
		expect(headers["x-content-type-options"], path).toBe("nosniff");
		expect(headers["referrer-policy"], path).toBe(
			"strict-origin-when-cross-origin",
		);
	}
});

test("another site can't show vauly in a frame", async ({ page, baseURL }) => {
	await page.route("http://elsewhere.example.test/", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: `<iframe title="vauly" src="${baseURL}/login"></iframe>`,
		}),
	);
	await page.goto("http://elsewhere.example.test/");
	// The browser shows its own error page in the frame instead of the app.
	await expect
		.poll(() =>
			page
				.frames()
				.find((frame) => frame !== page.mainFrame())
				?.url(),
		)
		.toMatch(/^chrome-error:/);
	await expect(
		page.frameLocator('iframe[title="vauly"]').getByLabel("Email"),
	).toHaveCount(0);
});

test("everything works under the policy", async ({ page, browser }) => {
	const refused = watchPolicy(page.context());
	// A stand-in for Brandfetch: the policy is checked before the request reaches it.
	await page.route("https://cdn.brandfetch.io/**", (route) =>
		route.fulfill({
			contentType: "image/png",
			body: Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
				"base64",
			),
		}),
	);
	await createWorkspace(page);

	// An item with a website, so its logo loads.
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name", { exact: true }).fill("GitHub");
	await dialog.getByLabel("Username").fill("alex-acme");
	await dialog
		.getByLabel("Password", { exact: true })
		.fill("copper-river-91!Q");
	await dialog.getByLabel("Website").fill("https://github.com/login");
	await dialog.getByRole("button", { name: "Add item" }).click();
	await expect(dialog).toBeHidden();
	const logo = page
		.getByRole("region", { name: "Items" })
		.locator('img[src^="https://cdn.brandfetch.io/"]')
		.first();
	await expect
		.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
		.toBeGreaterThan(0);

	// The command palette copies a password.
	await page.keyboard.press("ControlOrMeta+k");
	await page
		.getByRole("dialog")
		.getByPlaceholder("Search items, vaults and pages")
		.fill("github");
	await page.keyboard.press("ControlOrMeta+c");
	await expect(page.getByText("Copied password")).toBeVisible();
	await page.keyboard.press("Escape");

	// A share link opens for someone outside the workspace.
	await page.getByRole("button", { name: "Share a link" }).click();
	const share = page.getByRole("dialog");
	await share.getByRole("button", { name: "Create link" }).click();
	const url = (
		(await share.getByTestId("share-link").textContent()) ?? ""
	).trim();
	await share.getByRole("button", { name: "Done" }).click();
	const guestContext = await browser.newContext();
	const guestRefused = watchPolicy(guestContext);
	const guest = await guestContext.newPage();
	await guest.goto(url);
	await guest.getByRole("button", { name: "Show the item" }).click();
	await expect(guest.getByText("alex-acme")).toBeVisible();
	await guestContext.close();

	// The Emergency Kit opens in a window that shares the policy, and still prints.
	await page.context().addInitScript(() => {
		window.print = () => {
			document.body.dataset.printed = "yes";
		};
	});
	await openUserMenu(page, owner.name);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	const [kit] = await Promise.all([
		page.context().waitForEvent("page"),
		page.getByRole("button", { name: "Print Emergency Kit" }).click(),
	]);
	await expect(
		kit.getByRole("heading", { name: "vauly Emergency Kit" }),
	).toBeVisible();
	await expect(kit.locator("body")).toHaveAttribute("data-printed", "yes");
	await kit.close();

	// Locking and unlocking again.
	await page.getByRole("button", { name: "Lock now" }).click();
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expect(
		page.getByRole("navigation").getByRole("link", { name: "Private" }),
	).toBeVisible();

	expect(refused).toEqual([]);
	expect(guestRefused).toEqual([]);
});
