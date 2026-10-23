import { expect, type Page, test } from "@playwright/test";

import {
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	teammate,
} from "./helpers";

// The screens before the vault: setup, sign-in, joining and unlocking. Their card holds
// forms of very different lengths, so each is checked whole at desktop, tablet and
// phone sizes.

test.describe.configure({ mode: "serial" });

const sizes = [
	{ width: 1440, height: 900 },
	{ width: 1024, height: 768 },
	{ width: 768, height: 1024 },
	{ width: 390, height: 844 },
];

/** Fails when any box that clips its overflow cuts into the card, or the page scrolls sideways. */
async function expectWholeCard(page: Page, title: string) {
	for (const size of sizes) {
		await page.setViewportSize(size);
		await expect(page.getByRole("heading", { name: title })).toBeVisible();
		const cutBy = await page.getByRole("main").evaluate((card) => {
			const box = card.getBoundingClientRect();
			for (
				let parent = card.parentElement;
				parent;
				parent = parent.parentElement
			) {
				const style = getComputedStyle(parent);
				if (style.overflowX === "visible" && style.overflowY === "visible")
					continue;
				const frame = parent.getBoundingClientRect();
				if (
					box.top < frame.top - 1 ||
					box.bottom > frame.bottom + 1 ||
					box.left < frame.left - 1 ||
					box.right > frame.right + 1
				)
					return `${parent.tagName}.${parent.className}`;
			}
			return null;
		});
		expect(
			cutBy,
			`${title} at ${size.width}px: the card is cut off`,
		).toBeNull();
		const sideways = await page.evaluate(
			() => document.documentElement.scrollWidth - window.innerWidth,
		);
		expect(sideways, `${title} at ${size.width}px: scrolls sideways`).toBe(0);
	}
}

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

test("every sign-in screen shows its whole card at every size", async ({
	page,
	browser,
}) => {
	await page.goto("/");
	await expectWholeCard(page, "Create your workspace");

	await page.setViewportSize(sizes[0] ?? { width: 1440, height: 900 });
	await createWorkspace(page);
	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const inviteUrl = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.getByRole("button", { name: "Done" }).click();

	await page.getByRole("button", { name: "Lock now" }).click();
	await expectWholeCard(page, `Unlock ${owner.workspace}`);

	const guest = await browser.newPage();
	await guest.goto(inviteUrl);
	await expectWholeCard(guest, `Join ${owner.workspace}`);
	await guest.goto("/join?token=not-a-real-invite-token");
	await expectWholeCard(guest, "This invite doesn't work");
	await guest.goto("/login");
	await expectWholeCard(guest, `Sign in to ${owner.workspace}`);
	await guest.close();
});

test("the keyhole drifts over the ciphertext, reading the same rows", async ({
	page,
}) => {
	await page.goto("/login");
	const field = page.locator("[data-slot='cipher-field']");
	const x = () =>
		field.evaluate((element) => element.style.getPropertyValue("--x"));
	const start = await x();
	await expect.poll(x).not.toBe(start);

	// The plain rows have their spaces where the ciphertext has them, and however far the
	// keyhole has drifted, they sit exactly over it.
	const [cipher, plain] = await field.locator("pre").allTextContents();
	const shape = (text = "") => text.replace(/\S/g, "x");
	expect(cipher?.length).toBeGreaterThan(1000);
	expect(shape(plain)).toBe(shape(cipher));
	const offset = await field.evaluate((element) => {
		const [cipher, plain] = [...element.querySelectorAll("pre")].map((pre) =>
			pre.getBoundingClientRect(),
		);
		return cipher && plain
			? Math.hypot(plain.x - cipher.x, plain.y - cipher.y)
			: Number.NaN;
	});
	expect(offset).toBeLessThan(0.5);
});
