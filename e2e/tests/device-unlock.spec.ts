import { type CDPSession, expect, type Page, test } from "@playwright/test";

import {
	apiFromPage,
	createWorkspace,
	expectSignedIn,
	openUserMenu,
	owner,
	resetWorkspace,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

type Authenticator = { cdp: CDPSession; authenticatorId: string };

/**
 * A platform authenticator that verifies the person, the way Touch ID or Windows Hello
 * would, through the Chrome DevTools Protocol. `prf` says whether it can give a PRF output.
 */
async function addAuthenticator(
	page: Page,
	{ prf = true } = {},
): Promise<Authenticator> {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const { authenticatorId } = await cdp.send(
		"WebAuthn.addVirtualAuthenticator",
		{
			options: {
				protocol: "ctap2",
				ctap2Version: "ctap2_1",
				transport: "internal",
				hasResidentKey: true,
				hasUserVerification: true,
				isUserVerified: true,
				automaticPresenceSimulation: true,
				// Not in Playwright's protocol types yet.
				...({ hasPrf: prf } as object),
			},
		},
	);
	return { cdp, authenticatorId };
}

type Stored = {
	accountId: string;
	sealedPrivateKey: string;
	publicKey: string;
	sessionId: string;
	issuedAt: number;
};

/** What this device keeps in IndexedDB, read the way the app writes it. */
function stored(page: Page) {
	return page.evaluate(
		() =>
			new Promise<Stored[]>((resolve, reject) => {
				const opening = indexedDB.open("vauly", 1);
				opening.onupgradeneeded = () =>
					opening.result.createObjectStore("deviceUnlock", {
						keyPath: "accountId",
					});
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const database = opening.result;
					const all = database
						.transaction("deviceUnlock")
						.objectStore("deviceUnlock")
						.getAll();
					all.onsuccess = () => {
						database.close();
						resolve(all.result);
					};
				};
			}),
	);
}

/** Writes a record as if someone had edited this device's storage. */
function store(page: Page, record: Stored) {
	return page.evaluate(
		(value) =>
			new Promise<void>((resolve, reject) => {
				const opening = indexedDB.open("vauly", 1);
				opening.onerror = () => reject(opening.error);
				opening.onsuccess = () => {
					const database = opening.result;
					const transaction = database.transaction("deviceUnlock", "readwrite");
					transaction.objectStore("deviceUnlock").put(value);
					transaction.oncomplete = () => {
						database.close();
						resolve();
					};
				};
			}),
		record,
	);
}

async function openSettings(page: Page) {
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Settings" }).click();
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

const passkeyButton = (page: Page) =>
	page.getByRole("button", { name: "Unlock with passkey" });

/** Settings › Unlock with this device: the master password, then the passkey. */
async function turnOn(page: Page, password = owner.password) {
	await page.getByRole("switch", { name: "Unlock with this device" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Master password").fill(password);
	await dialog.getByRole("button", { name: "Continue" }).click();
	await dialog.getByRole("button", { name: "Create passkey" }).click();
	// Some authenticators answer PRF only when the passkey is used.
	const confirm = dialog.getByRole("button", { name: "Confirm with passkey" });
	const done = page.getByText("This device unlocks with a passkey now");
	await expect(confirm.or(done).or(dialog.getByRole("alert"))).toBeVisible();
	if (await confirm.isVisible()) await confirm.click();
	return dialog;
}

async function lock(page: Page) {
	await page.getByRole("button", { name: "Lock now" }).click();
	await expect(
		page.getByRole("heading", { name: `Unlock ${owner.workspace}` }),
	).toBeVisible();
}

/** Signs in with a passkey turned on, then locks. */
async function lockedWithPasskey(page: Page) {
	const authenticator = await addAuthenticator(page);
	await signIn(page, owner);
	await openSettings(page);
	await turnOn(page);
	await expect(
		page.getByText("This device unlocks with a passkey now"),
	).toBeVisible();
	await lock(page);
	await expect(passkeyButton(page)).toBeVisible();
	return authenticator;
}

/** Signs this account out everywhere but a second browser, which then goes away. */
async function signOutElsewhere(page: Page) {
	const elsewhere = await page.context().browser()?.newContext();
	if (!elsewhere) throw new Error("No browser");
	const other = await elsewhere.newPage();
	await signIn(other, owner);
	await openSettings(other);
	await other.getByRole("button", { name: "Sign out everywhere else" }).click();
	await expect(other.getByText("Signed out everywhere else")).toBeVisible();
	await elsewhere.close();
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await page.close();
});

test("a browser without a passkey on this device doesn't offer it", async ({
	page,
}) => {
	await signIn(page, owner);
	await openSettings(page);
	await expect(page.getByText("Lock after")).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toHaveCount(0);
});

test("a passkey without PRF is turned away", async ({ page }) => {
	await addAuthenticator(page, { prf: false });
	await signIn(page, owner);
	await openSettings(page);
	const dialog = await turnOn(page);
	await expect(dialog.getByRole("alert")).toContainText(
		"can't unlock vauly with a passkey",
	);
	await expect.poll(() => stored(page)).toEqual([]);
});

test("with a passkey, vauly unlocks without the master password", async ({
	page,
}) => {
	await addAuthenticator(page);
	await signIn(page, owner);
	await openSettings(page);

	await page.getByRole("switch", { name: "Unlock with this device" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Master password").fill("not my master password");
	await dialog.getByRole("button", { name: "Continue" }).click();
	await expect(dialog.getByRole("alert")).toContainText(
		"not your master password",
	);
	await dialog.getByRole("button", { name: "Cancel" }).click();

	await turnOn(page);
	await expect(
		page.getByText("This device unlocks with a passkey now"),
	).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).toBeChecked();
	expect(await stored(page)).toHaveLength(1);

	await lock(page);
	await passkeyButton(page).click();
	await expectSignedIn(page);

	// A reload forgets the keys too; the passkey still opens them.
	await page.reload();
	await passkeyButton(page).click();
	await expectSignedIn(page);

	// The master password works as well as ever.
	await lock(page);
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);

	await openSettings(page);
	await page.getByRole("switch", { name: "Unlock with this device" }).click();
	await expect(page.getByText("Unlocking with a passkey is off")).toBeVisible();
	await expect.poll(() => stored(page)).toEqual([]);
	await lock(page);
	await expect(passkeyButton(page)).toHaveCount(0);
});

test("a cancelled passkey keeps the copy, and says so", async ({ page }) => {
	const { cdp, authenticatorId } = await lockedWithPasskey(page);
	// The device's check fails, the way a cancelled Face ID prompt does.
	await cdp.send("WebAuthn.setUserVerified", {
		authenticatorId,
		isUserVerified: false,
	});
	await passkeyButton(page).click();
	await expect(page.getByRole("alert")).toContainText(
		"The passkey didn't unlock vauly",
	);
	expect(await stored(page)).toHaveLength(1);

	// The master password still works, and the passkey is still offered afterwards.
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);
	await lock(page);
	await expect(passkeyButton(page)).toBeVisible();
	expect(await stored(page)).toHaveLength(1);
});

test("a passkey removed from the device is explained", async ({ page }) => {
	const { cdp, authenticatorId } = await lockedWithPasskey(page);
	const { credentials } = await cdp.send("WebAuthn.getCredentials", {
		authenticatorId,
	});
	for (const { credentialId } of credentials) {
		await cdp.send("WebAuthn.removeCredential", {
			authenticatorId,
			credentialId,
		});
	}
	await passkeyButton(page).click();
	await expect(page.getByRole("alert")).toContainText(
		"If you removed the passkey",
	);
	await page.getByLabel("Master password").fill(owner.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);
});

test("a copy that was tampered with is removed", async ({ page }) => {
	await lockedWithPasskey(page);
	const [record] = await stored(page);
	if (!record) throw new Error("No copy stored");
	const [iv, ciphertext = ""] = record.sealedPrivateKey.split(".");
	const flipped = ciphertext.startsWith("A") ? "B" : "A";
	await store(page, {
		...record,
		sealedPrivateKey: `${iv}.${flipped}${ciphertext.slice(1)}`,
	});
	await page.reload();
	await passkeyButton(page).click();
	await expect(page.getByRole("alert")).toContainText(
		"didn't open, so vauly removed it",
	);
	await expect.poll(() => stored(page)).toEqual([]);
});

test("a copy for another key pair, session or account isn't offered", async ({
	page,
}) => {
	await lockedWithPasskey(page);
	const [record] = await stored(page);
	if (!record) throw new Error("No copy stored");

	// Another key pair: dropped when the app loads.
	await store(page, { ...record, publicKey: `${record.publicKey}x` });
	await page.reload();
	await expect(page.getByLabel("Master password")).toBeVisible();
	await expect(passkeyButton(page)).toHaveCount(0);
	await expect.poll(() => stored(page)).toEqual([]);

	// Copies from other sessions, this account's or another's, go the same way.
	await store(page, { ...record, sessionId: "an-old-session" });
	await store(page, {
		...record,
		accountId: "someone-else",
		sessionId: "their-session",
	});
	await page.reload();
	await expect(page.getByLabel("Master password")).toBeVisible();
	await expect(passkeyButton(page)).toHaveCount(0);
	await expect.poll(() => stored(page)).toEqual([]);
});

test("a copy runs out after 14 days, and the server holds to that", async ({
	page,
}) => {
	await lockedWithPasskey(page);
	const [record] = await stored(page);
	if (!record) throw new Error("No copy stored");
	const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60_000;

	const refused = await apiFromPage(page, "account/devicePepper", {
		issuedAt: fifteenDaysAgo,
	});
	expect(refused).toContain("FORBIDDEN");

	await store(page, { ...record, issuedAt: fifteenDaysAgo });
	await page.reload();
	await expect(page.getByText("lasts 14 days at a time")).toBeVisible();
	await expect(passkeyButton(page)).toHaveCount(0);
	await expect.poll(() => stored(page)).toEqual([]);
});

test("a session signed out elsewhere takes the copy with it", async ({
	page,
}) => {
	await lockedWithPasskey(page);
	await signOutElsewhere(page);

	// Still on the unlock screen: the server no longer hands out the pepper.
	await passkeyButton(page).click();
	await expect(page.getByLabel("Email")).toBeVisible();
	await expect.poll(() => stored(page)).toEqual([]);
});

test("starting up without the session drops the copy", async ({ page }) => {
	await lockedWithPasskey(page);
	await signOutElsewhere(page);
	await page.reload();
	await expect(page.getByLabel("Email")).toBeVisible();
	await expect.poll(() => stored(page)).toEqual([]);
});

test("a session that can't be checked leaves the copy alone", async ({
	page,
}) => {
	await lockedWithPasskey(page);
	await page.route("**/api/auth/get-session**", (route) => route.abort());
	const failed = page.waitForEvent("requestfailed", (request) =>
		request.url().includes("get-session"),
	);
	await page.reload();
	await failed;
	// Give the app the time it would take to drop the copy, if it did.
	await page.waitForTimeout(1000);
	expect(await stored(page)).toHaveLength(1);

	await page.unroute("**/api/auth/get-session**");
	await page.reload();
	await passkeyButton(page).click();
	await expectSignedIn(page);
});

test("signing out forgets this device's copy", async ({ page }) => {
	await lockedWithPasskey(page);
	await page.getByRole("button", { name: "Sign out" }).click();
	await expect(page.getByLabel("Email")).toBeVisible();
	await expect.poll(() => stored(page)).toEqual([]);
	await signIn(page, owner);
	await lock(page);
	await expect(passkeyButton(page)).toHaveCount(0);
});

test("a new master password drops this device's copy", async ({ page }) => {
	await lockedWithPasskey(page);
	await passkeyButton(page).click();
	await expectSignedIn(page);
	await openSettings(page);

	await page.getByRole("button", { name: "Change master password" }).click();
	const dialog = page.getByRole("dialog");
	const next = "violet anchor paper river 31";
	await dialog.getByLabel("Current master password").fill(owner.password);
	await dialog.getByLabel("New master password").fill(next);
	await dialog.getByLabel("Repeat the new one").fill(next);
	await dialog.getByRole("button", { name: "Change master password" }).click();
	await expect(page.getByText("Master password changed")).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Unlock with this device" }),
	).not.toBeChecked();
	await expect.poll(() => stored(page)).toEqual([]);
});
