import {
	type APIRequestContext,
	expect,
	type Page,
	request as playwrightRequest,
	test,
} from "@playwright/test";
import {
	type AccountKeys,
	changeMasterPassword,
	checkedMasterKeys,
	createAccount,
	type Kdf,
	newDataKey,
	open,
	publicKeyOf,
	sealJson,
	setArgon2,
	upgradeKdf,
	wrapKeyFor,
} from "@vauly/crypto";
import { argon2id } from "@vauly/crypto/argon2";

import { API_URL } from "../playwright.config";
import {
	createWorkspace,
	expectSignedIn,
	openUserMenu,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

// Master passwords go through Argon2id. Accounts made before it used PBKDF2, and move
// over the next time their owner unlocks with the master password, keeping their key
// pair, their vaults and their other sessions. The server takes that move once, and
// only from the keys it started from; the apps refuse settings weaker than vauly allows.

test.describe.configure({ mode: "serial" });

setArgon2(argon2id);

const PBKDF2: Kdf = {
	kdf: "pbkdf2",
	kdfIterations: 600_000,
	kdfPasses: null,
	kdfMemory: null,
};
const NEW_ACCOUNT = {
	kdf: "argon2id",
	kdfIterations: 600_000,
	kdfPasses: 3,
	kdfMemory: 65_536,
};

/** Calls the API the way an app does; the response is checked by the caller. */
const call = (api: APIRequestContext, path: string, json: unknown) =>
	api.post(`${API_URL}/rpc/${path}`, { data: { json } });

async function rpc(api: APIRequestContext, path: string, json: unknown) {
	const response = await call(api, path, json);
	expect(response.ok(), `${path}: ${await response.text()}`).toBe(true);
	return (await response.json()).json;
}

let anonymous: APIRequestContext;
const settingsOf = (email: string) =>
	rpc(anonymous, "account/prelogin", { email });

/** A session of its own, signed in with an auth key, the way an app signs in. */
async function sessionFor(email: string, authKey: string) {
	const api = await playwrightRequest.newContext({
		extraHTTPHeaders: { origin: API_URL },
	});
	const response = await api.post(`${API_URL}/api/auth/sign-in/email`, {
		data: { email, password: authKey },
	});
	expect(response.ok(), await response.text()).toBe(true);
	return api;
}

/** Someone who joined from an app that still used PBKDF2, invited by the owner. */
async function pbkdf2Teammate(email: string, password: string) {
	const ownerKeys = await checkedMasterKeys(
		owner.password,
		await settingsOf(owner.email),
	);
	const ownerApi = await sessionFor(owner.email, ownerKeys.authKey);
	const { token } = await rpc(ownerApi, "members/invite", {
		email,
		role: "member",
	});
	await ownerApi.dispose();
	const account = await createAccount(password, PBKDF2);
	const vaultKey = await newDataKey();
	await rpc(anonymous, "account/register", {
		email,
		name: email.split("@")[0],
		authKey: account.authKey,
		keys: account.keys,
		inviteToken: token,
		personalVault: {
			encryptedMeta: await sealJson(vaultKey, {
				name: "Private",
				description: "Only you can open this vault.",
				tone: "violet",
			}),
			wrappedKey: await wrapKeyFor(account.keys.publicKey, vaultKey),
		},
	});
	expect(await settingsOf(email)).toMatchObject(PBKDF2);
	return account;
}

/** New keys as changePassword and upgradeKdf take them. */
const newKeys = ({ publicKey: _, ...keys }: AccountKeys) => keys;

/** The account signs in with this password and opens to the same key pair. */
async function expectWhole(email: string, password: string, publicKey: string) {
	const keys = await checkedMasterKeys(password, await settingsOf(email));
	const api = await sessionFor(email, keys.authKey);
	const me = await rpc(api, "account/me", null);
	await api.dispose();
	const pkcs8 = await open(keys.wrapKey, me.keys.encryptedPrivateKey);
	expect(await publicKeyOf(pkcs8)).toBe(publicKey);
}

test.beforeAll(async () => {
	anonymous = await playwrightRequest.newContext();
});

test.afterAll(async () => {
	await anonymous.dispose();
});

test("a new account derives its keys with Argon2id", async ({
	page,
	request,
}) => {
	await resetWorkspace(request);
	await createWorkspace(page);
	expect(await settingsOf(owner.email)).toMatchObject(NEW_ACCOUNT);
	// An email nobody has gets the same answer, so it doesn't tell.
	expect(await settingsOf("nobody@acme.test")).toMatchObject(NEW_ACCOUNT);
});

test("an account from before Argon2id moves over when it next signs in", async ({
	page,
	browser,
}) => {
	const mei = {
		email: "mei@acme.test",
		password: "blue lantern quiet harbor 77",
	};
	const account = await pbkdf2Teammate(mei.email, mei.password);

	// Their laptop is signed in already.
	const laptop = await sessionFor(mei.email, account.authKey);

	// Signing in with the master password moves the account, after the vault opens.
	const phone = await browser.newContext();
	await signIn(await phone.newPage(), mei);
	await expect
		.poll(async () => (await settingsOf(mei.email)).kdf, { timeout: 20_000 })
		.toBe("argon2id");
	expect(await settingsOf(mei.email)).toMatchObject(NEW_ACCOUNT);

	// The same password signs in afresh and opens the same vaults.
	const desktop = await browser.newContext();
	await signIn(await desktop.newPage(), mei);
	// The laptop stayed signed in: the password didn't change.
	expect((await call(laptop, "account/me", null)).status()).toBe(200);

	// The owner's activity log says what happened.
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	await expect(
		page.getByText("moved their master password to Argon2id"),
	).toBeVisible();

	await Promise.all([phone.close(), desktop.close(), laptop.dispose()]);
});

test("the server takes a move once, from PBKDF2, with the right key and allowed settings", async () => {
	const kai = {
		email: "kai@acme.test",
		password: "tidal-marble-violin-orchard",
	};
	const account = await pbkdf2Teammate(kai.email, kai.password);
	const api = await sessionFor(kai.email, account.authKey);
	const moved = await upgradeKdf(kai.password, account.keys);
	const move = (changes: object) =>
		call(api, "account/upgradeKdf", {
			currentAuthKey: moved.currentAuthKey,
			authKey: moved.authKey,
			keys: newKeys(moved.keys),
			...changes,
		});

	// Not without the current master password.
	expect((await move({ currentAuthKey: "0".repeat(64) })).status()).toBe(403);
	// Not with settings the apps wouldn't use.
	for (const keys of [
		{ ...newKeys(moved.keys), kdfPasses: 1 },
		{ ...newKeys(moved.keys), kdfMemory: 8 * 1024 },
		{ ...newKeys(moved.keys), kdfIterations: 3 },
		{ ...newKeys(moved.keys), kdfSalt: "AAAAAAAAAAAAAAAA" },
		{ ...newKeys(moved.keys), ...PBKDF2 },
	]) {
		expect((await move({ keys })).status(), JSON.stringify(keys)).toBe(400);
	}
	expect(await settingsOf(kai.email)).toMatchObject(PBKDF2);

	// Once, and then not again: the account isn't on PBKDF2 anymore.
	expect((await move({})).status()).toBe(200);
	expect(await settingsOf(kai.email)).toMatchObject(NEW_ACCOUNT);
	const again = await upgradeKdf(kai.password, moved.keys);
	const twice = await call(api, "account/upgradeKdf", {
		currentAuthKey: again.currentAuthKey,
		authKey: again.authKey,
		keys: newKeys(again.keys),
	});
	expect(twice.status()).toBe(409);
	await expectWhole(kai.email, kai.password, account.keys.publicKey);
	await api.dispose();
});

test("of several moves at once, one wins and the account stays whole", async () => {
	const ana = { email: "ana@acme.test", password: "copper-kettle-meadow-lark" };
	const account = await pbkdf2Teammate(ana.email, ana.password);
	// Five devices, each with its own session and its own new keys, all at once.
	const devices = await Promise.all(
		Array.from({ length: 5 }, async () => ({
			api: await sessionFor(ana.email, account.authKey),
			moved: await upgradeKdf(ana.password, account.keys),
		})),
	);
	const statuses = (
		await Promise.all(
			devices.map(({ api, moved }) =>
				call(api, "account/upgradeKdf", {
					currentAuthKey: moved.currentAuthKey,
					authKey: moved.authKey,
					keys: newKeys(moved.keys),
				}),
			),
		)
	).map((response) => response.status());
	// The rest are refused: their auth key no longer matches, their account has moved
	// already, or it moved while they were on their way (409 too).
	expect(statuses.filter((status) => status === 200)).toHaveLength(1);
	for (const status of statuses.filter((status) => status !== 200)) {
		expect([403, 409]).toContain(status);
	}
	const winner = devices[statuses.indexOf(200)]?.moved;
	expect((await settingsOf(ana.email)).kdfSalt).toBe(winner?.keys.kdfSalt);
	await expectWhole(ana.email, ana.password, account.keys.publicKey);
	await Promise.all(devices.map(({ api }) => api.dispose()));
});

test("a move and a password change at once: one wins, and the account stays whole", async () => {
	const ola = {
		email: "ola@acme.test",
		password: "saffron-glacier-pencil-otter",
	};
	const next = "harbor-violet-engine-thistle";
	const account = await pbkdf2Teammate(ola.email, ola.password);
	const [mover, changer] = await Promise.all([
		sessionFor(ola.email, account.authKey),
		sessionFor(ola.email, account.authKey),
	]);
	const [moved, changed] = await Promise.all([
		upgradeKdf(ola.password, account.keys),
		changeMasterPassword(ola.password, next, account.keys),
	]);
	const [move, change] = (
		await Promise.all([
			call(mover, "account/upgradeKdf", {
				currentAuthKey: moved.currentAuthKey,
				authKey: moved.authKey,
				keys: newKeys(moved.keys),
			}),
			call(changer, "account/changePassword", {
				currentAuthKey: changed.currentAuthKey,
				authKey: changed.authKey,
				keys: newKeys(changed.keys),
			}),
		])
	).map((response) => response.status());
	expect([move, change].filter((status) => status === 200)).toHaveLength(1);
	// Never the old password back under the new keys, or the other way round.
	await expectWhole(
		ola.email,
		change === 200 ? next : ola.password,
		account.keys.publicKey,
	);
	await Promise.all([mover.dispose(), changer.dispose()]);
});

test("a lost reply to the move leaves the account moved and working", async ({
	browser,
}) => {
	const ivo = { email: "ivo@acme.test", password: "lantern-quarry-meadow-fig" };
	const account = await pbkdf2Teammate(ivo.email, ivo.password);
	const phone = await browser.newContext();
	// The move reaches the server, but its answer never comes back.
	await phone.route("**/rpc/account/upgradeKdf", async (route) => {
		await route.fetch();
		await route.abort();
	});
	const page = await phone.newPage();
	await signIn(page, ivo);
	await expect
		.poll(async () => (await settingsOf(ivo.email)).kdf, { timeout: 20_000 })
		.toBe("argon2id");
	// The next unlock, on that device too, uses the new keys.
	await page.reload();
	await page.getByLabel("Master password").fill(ivo.password);
	await page.getByRole("button", { name: "Unlock", exact: true }).click();
	await expectSignedIn(page);
	await expectWhole(ivo.email, ivo.password, account.keys.publicKey);
	await phone.close();
});

/** Answers the sign-in page's prelogin with these settings instead of the server's. */
async function answerPrelogin(page: Page, settings: object) {
	await page.route("**/rpc/account/prelogin", (route) =>
		route.fulfill({ json: { json: settings } }),
	);
	const signIns: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("/api/auth/sign-in"))
			signIns.push(request.url());
	});
	return signIns;
}

async function trySignIn(
	page: Page,
	person: { email: string; password: string },
) {
	await page.goto("/login");
	await page.getByLabel("Email").fill(person.email);
	await page.getByLabel("Master password").fill(person.password);
	await page.getByRole("button", { name: "Sign in" }).click();
}

test("the app refuses settings weaker than vauly allows", async ({ page }) => {
	const signIns = await answerPrelogin(page, {
		kdfSalt: "AAAAAAAAAAAAAAAAAAAAAA==",
		...PBKDF2,
		kdfIterations: 1_000,
	});
	await trySignIn(page, owner);
	await expect(page.getByRole("alert")).toContainText(
		"different key derivation than vauly allows",
	);
	// The password never went into them, so nothing went to the server.
	expect(signIns).toEqual([]);
});

test("a device that has seen an account use Argon2id refuses PBKDF2 for it", async ({
	page,
}) => {
	await signIn(page, owner);
	await openUserMenu(page);
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	const { kdfSalt } = await settingsOf(owner.email);
	const signIns = await answerPrelogin(page, { kdfSalt, ...PBKDF2 });
	await trySignIn(page, owner);
	await expect(page.getByRole("alert")).toContainText(
		"now asks for older key derivation",
	);
	expect(signIns).toEqual([]);
});
