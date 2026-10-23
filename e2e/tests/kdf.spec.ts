import {
	type APIRequestContext,
	expect,
	request as playwrightRequest,
	test,
} from "@playwright/test";
import {
	createAccount,
	type Kdf,
	newDataKey,
	sealJson,
	wrapKeyFor,
} from "@vauly/crypto";

import { API_URL } from "../playwright.config";
import {
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// Master passwords go through Argon2id. Accounts made before it used PBKDF2, and move
// over the next time their owner unlocks with the master password, keeping their key
// pair, their vaults and their other sessions.

test.describe.configure({ mode: "serial" });

const PBKDF2: Kdf = { kdf: "pbkdf2", kdfIterations: 600_000, kdfMemory: null };

async function rpc(request: APIRequestContext, path: string, json: unknown) {
	const response = await request.post(`${API_URL}/rpc/${path}`, {
		data: { json },
	});
	expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
	return (await response.json()).json;
}

const settingsOf = async (request: APIRequestContext, email: string) =>
	rpc(request, "account/prelogin", { email });

test.beforeAll(async ({ request }) => {
	await resetWorkspace(request);
});

test("a new account derives its keys with Argon2id", async ({
	page,
	request,
}) => {
	await createWorkspace(page);
	const argon2id = { kdf: "argon2id", kdfIterations: 3, kdfMemory: 65_536 };
	expect(await settingsOf(request, owner.email)).toMatchObject(argon2id);
	// An email nobody has gets the same answer, so it doesn't tell.
	expect(await settingsOf(request, "nobody@acme.test")).toMatchObject(argon2id);
});

test("an account from before Argon2id moves over when it next signs in", async ({
	page,
	browser,
	request,
}) => {
	// The owner invites a teammate, who joins from an app that still used PBKDF2.
	await signIn(page, owner);
	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const inviteUrl = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.getByRole("button", { name: "Done" }).click();
	const account = await createAccount(teammate.password, PBKDF2);
	const vaultKey = await newDataKey();
	await rpc(request, "account/register", {
		email: teammate.email,
		name: teammate.name,
		authKey: account.authKey,
		keys: account.keys,
		inviteToken: new URL(inviteUrl).searchParams.get("token"),
		personalVault: {
			encryptedMeta: await sealJson(vaultKey, {
				name: "Private",
				description: "Only you can open this vault.",
				tone: "violet",
			}),
			wrappedKey: await wrapKeyFor(account.keys.publicKey, vaultKey),
		},
	});
	expect(await settingsOf(request, teammate.email)).toMatchObject({
		kdf: "pbkdf2",
		kdfIterations: 600_000,
	});

	// Their laptop is signed in already.
	const laptop = await playwrightRequest.newContext();
	const signedIn = await laptop.post(`${API_URL}/api/auth/sign-in/email`, {
		data: { email: teammate.email, password: account.authKey },
		headers: { origin: API_URL },
	});
	expect(signedIn.ok()).toBe(true);

	// Signing in with the master password moves the account, after the vault opens.
	const phone = await browser.newContext();
	await signIn(await phone.newPage(), teammate);
	await expect
		.poll(async () => (await settingsOf(request, teammate.email)).kdf, {
			timeout: 20_000,
		})
		.toBe("argon2id");
	expect(await settingsOf(request, teammate.email)).toMatchObject({
		kdfIterations: 3,
		kdfMemory: 65_536,
	});

	// The same password signs in afresh and opens the same vaults.
	const desktop = await browser.newContext();
	await signIn(await desktop.newPage(), teammate);
	// The laptop stayed signed in: the password didn't change.
	expect(
		(
			await laptop.post(`${API_URL}/rpc/account/me`, { data: { json: null } })
		).status(),
	).toBe(200);

	// The owner's activity log says what happened.
	await sidebarLink(page, "Activity").click();
	await expect(
		page.getByText("moved their master password to Argon2id"),
	).toBeVisible();

	await Promise.all([phone.close(), desktop.close(), laptop.dispose()]);
});
