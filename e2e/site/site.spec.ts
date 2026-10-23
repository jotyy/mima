import { expect, type Page, test } from "@playwright/test";

const docs = [
	"/docs/",
	"/docs/self-hosting/",
	"/docs/browser-extension/",
	"/docs/agents/",
	"/docs/security/",
];

/** Fails on any page asset that doesn't load, such as a stylesheet with a stale name. */
function watchAssets(page: Page) {
	const missing: string[] = [];
	page.on("response", (response) => {
		if (response.status() >= 400)
			missing.push(`${response.status()} ${response.url()}`);
	});
	return missing;
}

test("the landing page leads into the docs", async ({ page }) => {
	await page.goto("/");
	await expect(page).toHaveTitle(/mima/);
	await expect(page.getByRole("heading", { level: 1 })).toContainText(
		"The password manager",
	);
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: "Docs" })
		.click();
	await expect(page).toHaveURL(/\/docs\/$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Introduction" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Home" }).click();
	await expect(page).toHaveURL(/\/$/);
});

test("the demo encrypts what you type, in the page", async ({ page }) => {
	await page.goto("/");
	const name = page.getByLabel("Name", { exact: true });
	await name.scrollIntoViewIfNeeded();
	const server = page
		.locator("pre")
		.filter({ hasText: "POST /rpc/items/create" });
	await expect(server).toContainText('"data": "');
	const before = await server.textContent();

	await name.fill("Launch plans");
	await expect.poll(() => server.textContent()).not.toBe(before);
	await expect(server).not.toContainText("Launch plans");
	await expect(server).not.toContainText("GitHub");
});

test("the theme chosen on the landing page carries into the docs", async ({
	page,
}) => {
	await page.goto("/");
	await page
		.getByRole("radiogroup", { name: "Theme" })
		.getByRole("radio", { name: "Dark" })
		.click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.goto("/docs/");
	await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page
		.getByRole("radiogroup", { name: "Theme" })
		.getByRole("radio", { name: "Light" })
		.click();
	await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
	await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("every docs page loads all it asks for, diagrams and code styles included", async ({
	page,
}) => {
	const missing = watchAssets(page);
	for (const path of docs) {
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
	}
	expect(missing).toEqual([]);

	await page.goto("/docs/security/");
	await expect(
		page.getByRole("figure", {
			name: "How a master password becomes the key to one item",
		}),
	).toBeVisible();
	await page.goto("/docs/self-hosting/");
	await expect(
		page.getByRole("figure", {
			name: "What a deploy creates and what talks to it",
		}),
	).toBeVisible();
	await page.goto("/docs/agents/");
	await expect(
		page.getByRole("figure", {
			name: "How a command gets a secret through mima run",
		}),
	).toBeVisible();
});

test("the questions open one answer at a time", async ({ page }) => {
	await page.goto("/#faq");
	const first = page.locator("details").filter({ hasText: "Is mima free?" });
	const second = page
		.locator("details")
		.filter({ hasText: "What if I forget my master password?" });
	await first.locator("summary").click();
	await expect(first).toHaveAttribute("open", "");
	await second.locator("summary").click();
	await expect(second).toHaveAttribute("open", "");
	await expect(first).not.toHaveAttribute("open", "");
});

test("a page that isn't there says so, and leads back", async ({ page }) => {
	const response = await page.goto("/docs/not-a-page/");
	expect(response?.status()).toBe(404);
	await expect(
		page.getByRole("heading", { name: "Nothing here" }),
	).toBeVisible();
	await page.getByRole("link", { name: "Back to mima" }).click();
	await expect(page).toHaveURL(/\/$/);
});

test("the nav marks the section being read", async ({ page }) => {
	await page.goto("/");
	const nav = page.getByRole("navigation", { name: "Main" });
	await page.evaluate(() =>
		document.getElementById("security")?.scrollIntoView(),
	);
	await expect(nav.getByRole("link", { name: "Security" })).toHaveAttribute(
		"aria-current",
		"true",
	);
	await page.evaluate(() => window.scrollTo(0, 0));
	await expect(nav.locator("[aria-current]")).toHaveCount(0);
});

test.describe("on a phone", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("no page scrolls sideways", async ({ page }) => {
		for (const path of ["/", ...docs]) {
			await page.goto(path);
			const overflow = await page.evaluate(
				() =>
					document.documentElement.scrollWidth -
					document.documentElement.clientWidth,
			);
			expect(overflow, path).toBeLessThanOrEqual(0);
		}
	});

	test("the closing panel's words fit the screen", async ({ page }) => {
		await page.goto("/");
		const words = page.getByText(
			"Free, open source, and running on your own Cloudflare.",
		);
		await words.scrollIntoViewIfNeeded();
		const box = await words.boundingBox();
		expect(box && box.x + box.width).toBeLessThanOrEqual(390);
	});
});

test.describe("accessibility", () => {
	for (const path of ["/", "/docs/", "/docs/security/", "/docs/agents/"]) {
		test(`${path} has no serious accessibility problems`, async ({ page }) => {
			const { default: AxeBuilder } = await import("@axe-core/playwright");
			await page.goto(path);
			// Let everything that eases in on scroll show first.
			await page.evaluate(async () => {
				for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
					window.scrollTo(0, y);
					await new Promise((resolve) => setTimeout(resolve, 60));
				}
			});
			await page.waitForTimeout(900);
			const { violations } = await new AxeBuilder({ page })
				.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
				.analyze();
			const serious = violations
				.filter((v) => v.impact === "serious" || v.impact === "critical")
				// Starlight's search button shows its shortcut beside the name; not ours to rename.
				.filter(
					(v) =>
						!(
							v.id === "label-content-name-mismatch" &&
							v.nodes.every((n) =>
								n.target.join(" ").includes("data-open-modal"),
							)
						),
				)
				.map(
					(v) =>
						`${v.id}: ${v.nodes
							.map((n) => n.target.join(" "))
							.slice(0, 4)
							.join(" | ")}`,
				);
			expect(serious).toEqual([]);
		});
	}
});
