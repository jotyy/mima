import { execFileSync } from "node:child_process";
import path from "node:path";
import {
	type BrowserContext,
	chromium,
	expect,
	type FrameLocator,
	type Page,
	type Route,
	test,
} from "@playwright/test";
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type WebAuthnCredential,
} from "@simplewebauthn/server";

import { WEB_PORT } from "../playwright.config";
import {
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
} from "./helpers";

// Passkeys in the browser extension. A made-up site, Acme, makes and checks passkeys the
// way a real one would, with @simplewebauthn/server standing in for its server, and the
// browser's own passkeys are a virtual authenticator.

test.describe.configure({ mode: "serial" });

const extensionDir = path.resolve(import.meta.dirname, "../../apps/extension");
const extensionPath = path.join(extensionDir, ".output/chrome-mv3");
const rpID = "acme.test";
const site = "https://login.acme.test";

let context: BrowserContext;
let extensionId = "";

// ── Acme's server ───────────────────────────────────────────────────────────────────

const accounts = new Map<string, WebAuthnCredential[]>();
let challenge = "";

const acmePage = `<!doctype html>
<title>Acme</title>
<label>Email <input id="email" value="alex@acme.test"></label>
<button id="create">Create a passkey</button>
<button id="signin">Sign in with a passkey</button>
<output id="result"></output>
<script>
	const b64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)))
		.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	const post = async (path, body) =>
		(await fetch(path, { method: "POST", body: JSON.stringify(body) })).json();
	const show = (text) => (document.getElementById("result").textContent = text);
	const kind = (credential) =>
		credential instanceof PublicKeyCredential ? "" : " (not a PublicKeyCredential)";
	document.getElementById("create").onclick = async () => {
		show("");
		try {
			const options = await post("/register/options", { email: email.value });
			const credential = await navigator.credentials.create({
				publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options),
			});
			// Read field by field, as most sites' WebAuthn libraries do.
			const { response } = credential;
			const result = await post("/register/verify", {
				email: email.value,
				credential: {
					id: credential.id,
					rawId: b64(credential.rawId),
					type: credential.type,
					authenticatorAttachment: credential.authenticatorAttachment,
					clientExtensionResults: credential.getClientExtensionResults(),
					response: {
						clientDataJSON: b64(response.clientDataJSON),
						attestationObject: b64(response.attestationObject),
						transports: response.getTransports(),
						publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
						publicKey: b64(response.getPublicKey()),
						authenticatorData: b64(response.getAuthenticatorData()),
					},
				},
			});
			show(result.verified ? "Passkey created" + kind(credential) : "Passkey refused");
		} catch (error) {
			show(error.name + ": " + error.message);
		}
	};
	document.getElementById("signin").onclick = async () => {
		show("");
		try {
			const options = await post("/login/options", {});
			const credential = await navigator.credentials.get({
				publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options),
			});
			const result = await post("/login/verify", credential.toJSON());
			show(result.email ? "Signed in as " + result.email + kind(credential) : "Sign-in refused");
		} catch (error) {
			show(error.name + ": " + error.message);
		}
	};
</script>`;

async function acme(route: Route) {
	const request = route.request();
	const { pathname, origin } = new URL(request.url());
	const json = (body: unknown) =>
		route.fulfill({ contentType: "application/json", json: body });
	const body = request.method() === "POST" ? request.postDataJSON() : null;

	if (pathname === "/register/options") {
		const options = await generateRegistrationOptions({
			rpName: "Acme",
			rpID,
			userName: body.email,
			userID: new TextEncoder().encode(body.email),
			attestationType: "none",
			excludeCredentials: (accounts.get(body.email) ?? []).map(({ id }) => ({
				id,
			})),
			authenticatorSelection: { residentKey: "required" },
			extensions: { credProps: true },
		});
		challenge = options.challenge;
		return json(options);
	}
	if (pathname === "/register/verify") {
		const result = await verifyRegistrationResponse({
			response: body.credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
		}).catch(() => null);
		if (result?.verified && result.registrationInfo) {
			accounts.set(body.email, [
				...(accounts.get(body.email) ?? []),
				result.registrationInfo.credential,
			]);
		}
		return json({ verified: Boolean(result?.verified) });
	}
	if (pathname === "/login/options") {
		const options = await generateAuthenticationOptions({ rpID });
		challenge = options.challenge;
		return json(options);
	}
	if (pathname === "/login/verify") {
		const owned = [...accounts].find(([, credentials]) =>
			credentials.some((credential) => credential.id === body.id),
		);
		const credential = owned?.[1].find(({ id }) => id === body.id);
		if (!owned || !credential) return json({});
		const result = await verifyAuthenticationResponse({
			response: body,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			credential,
		}).catch(() => null);
		return json(result?.verified ? { email: owned[0] } : {});
	}
	return route.fulfill({ contentType: "text/html", body: acmePage });
}

/** A site that asks for Acme's passkeys, which no browser or vauly should give it. */
const otherPage = `<!doctype html>
<title>Not Acme</title>
<button id="signin">Sign in with a passkey</button>
<output id="result"></output>
<script>
	document.getElementById("signin").onclick = async () => {
		try {
			await navigator.credentials.get({
				publicKey: { challenge: new Uint8Array(32), rpId: "acme.test" },
			});
			document.getElementById("result").textContent = "Got a passkey";
		} catch (error) {
			document.getElementById("result").textContent = error.name;
		}
	};
</script>`;

// ── The browser, the extension and vauly ────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
	test.setTimeout(180_000);
	execFileSync("bun", ["run", "build"], { cwd: extensionDir, stdio: "ignore" });
	await resetWorkspace(request);

	context = await chromium.launchPersistentContext("", {
		channel: "chromium",
		baseURL: `http://localhost:${WEB_PORT}`,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
		],
	});
	const worker =
		context.serviceWorkers()[0] ??
		(await context.waitForEvent("serviceworker"));
	extensionId = new URL(worker.url()).host;
	await context.route(/^https:\/\/([a-z]+\.)?acme\.test\//, acme);
	await context.route("https://other.test/**", (route) =>
		route.fulfill({ contentType: "text/html", body: otherPage }),
	);

	const page = await context.newPage();
	await createWorkspace(page);
	// A login saved before, for an account that will get a passkey too.
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("Acme, Sam");
	await form.getByLabel("Username").fill("sam@acme.test");
	await form.getByLabel("Password", { exact: true }).fill("sam-acme-pass-81");
	await form.getByLabel("Website").fill("https://acme.test");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.close();

	const popup = await openPopup();
	await popup.getByLabel("vauly address").fill(`http://localhost:${WEB_PORT}`);
	await popup.getByRole("button", { name: "Continue" }).click();
	await popup.getByLabel("Email").fill(owner.email);
	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Sign in" }).click();
	await expect(popup.getByRole("list", { name: "All items" })).toBeVisible();
	await popup.close();
});

test.afterAll(async () => {
	await context?.close();
});

async function openPopup() {
	const popup = await context.newPage();
	await popup.goto(`chrome-extension://${extensionId}/popup.html`);
	return popup;
}

/** The browser's own passkeys, as an authenticator built into the device. */
async function withDeviceAuthenticator(page: Page) {
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
}

async function openAcme(email = "alex@acme.test") {
	const page = await context.newPage();
	await page.goto(`${site}/`);
	await page.getByLabel("Email").fill(email);
	return page;
}

const prompt = (page: Page): FrameLocator =>
	page.frameLocator('iframe[title="vauly: passkey"]');
const result = (page: Page) => page.locator("#result");

async function openApp() {
	const app = await context.newPage();
	await app.goto("/items");
	await app.getByLabel("Master password").fill(owner.password);
	await app.getByRole("button", { name: "Unlock", exact: true }).click();
	return app;
}

async function openItem(app: Page, name: string) {
	await app
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: new RegExp(`^${name}`) })
		.click();
	return app
		.getByRole("main")
		.locator("section")
		.filter({ hasText: "Updated" })
		.first();
}

// ── Saving and signing in ───────────────────────────────────────────────────────────

test("a passkey a site makes is saved in vauly, and the site accepts it", async () => {
	const page = await openAcme();
	await page.getByRole("button", { name: "Create a passkey" }).click();
	const card = prompt(page).getByRole("region", { name: "Passkey" });
	await expect(
		card.getByRole("heading", { name: "Save a passkey for acme.test?" }),
	).toBeVisible();
	await expect(card.getByText("signs you in as alex@acme.test")).toBeVisible();
	await card.getByRole("button", { name: "Save passkey" }).click();
	await expect(
		prompt(page).getByText("Passkey saved to Private"),
	).toBeVisible();
	await expect(result(page)).toHaveText("Passkey created");
	await expect(page.locator("vauly-frame")).toHaveCount(0);
	await page.close();
});

test("the passkey signs in, and the site checks its signature", async () => {
	const page = await openAcme();
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	const card = prompt(page).getByRole("region", { name: "Passkey" });
	await expect(
		card.getByRole("heading", { name: "Sign in to acme.test with a passkey?" }),
	).toBeVisible();
	await card.getByRole("button", { name: "Sign in as alex@acme.test" }).click();
	await expect(result(page)).toHaveText("Signed in as alex@acme.test");
	await page.close();
});

test("the web app shows the passkey, keeps it through an edit, and logs its use", async () => {
	const app = await openApp();
	await openAllItems(app);
	let item = await openItem(app, "acme.test");
	await expect(item.getByText("alex@acme.test on acme.test")).toBeVisible();
	await expect(
		item.getByText("vauly's browser extension signs in with it."),
	).toBeVisible();

	await app.getByRole("button", { name: "Edit", exact: true }).click();
	const form = app.getByRole("dialog");
	await form.getByLabel("Name", { exact: true }).fill("Acme, Alex");
	await form.getByRole("button", { name: "Save" }).click();
	await expect(form).toBeHidden();
	item = await openItem(app, "Acme, Alex");
	await expect(item.getByText("alex@acme.test on acme.test")).toBeVisible();

	await sidebarLink(app, "Activity").click();
	await expect(
		app
			.getByRole("list", { name: "Events" })
			.getByText("signed in with the passkey of"),
	).toBeVisible();
	await app.close();

	// Still signs in after the edit.
	const page = await openAcme();
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await prompt(page)
		.getByRole("button", { name: "Sign in as alex@acme.test" })
		.click();
	await expect(result(page)).toHaveText("Signed in as alex@acme.test");
	await page.close();
});

test("a passkey for an account with a saved login goes into that login", async () => {
	const page = await openAcme("sam@acme.test");
	await page.getByRole("button", { name: "Create a passkey" }).click();
	const card = prompt(page).getByRole("region", { name: "Passkey" });
	await expect(
		card.getByText("It goes into your login Acme, Sam in Private."),
	).toBeVisible();
	await card.getByRole("button", { name: "Save passkey" }).click();
	await expect(result(page)).toHaveText("Passkey created");
	await page.close();

	const app = await openApp();
	await openAllItems(app);
	const item = await openItem(app, "Acme, Sam");
	await expect(item.getByText("sam@acme.test on acme.test")).toBeVisible();
	await app.close();
});

test("a second passkey for the same account is refused, as the site asks", async () => {
	const page = await openAcme();
	await page.getByRole("button", { name: "Create a passkey" }).click();
	const card = prompt(page).getByRole("region", { name: "Passkey" });
	await expect(
		card.getByRole("heading", {
			name: "vauly has a passkey for acme.test already",
		}),
	).toBeVisible();
	await card.getByRole("button", { name: "OK" }).click();
	await expect(result(page)).toHaveText(/^InvalidStateError/);
	await page.close();
});

// ── The browser's own passkeys, and saying no ───────────────────────────────────────

test("Use another way hands the request to the browser's own passkeys", async () => {
	const page = await openAcme("kim@acme.test");
	await withDeviceAuthenticator(page);
	await page.getByRole("button", { name: "Create a passkey" }).click();
	await prompt(page).getByRole("button", { name: "Use another way" }).click();
	await expect(result(page)).toHaveText("Passkey created");
	await expect(page.locator("vauly-frame")).toHaveCount(0);

	// vauly has passkeys for acme.test, so it asks; the device's passkey still signs in.
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await expect(
		prompt(page).getByRole("button", { name: "Sign in as alex@acme.test" }),
	).toBeVisible();
	await prompt(page).getByRole("button", { name: "Use another way" }).click();
	await expect(result(page)).toHaveText("Signed in as kim@acme.test");
	await page.close();
});

test("Cancel turns the request down", async () => {
	const page = await openAcme("lee@acme.test");
	await page.getByRole("button", { name: "Create a passkey" }).click();
	await prompt(page).getByRole("button", { name: "Cancel" }).click();
	await expect(result(page)).toHaveText(/^NotAllowedError/);
	await expect(page.locator("vauly-frame")).toHaveCount(0);
	await page.close();
});

test("another site can't ask for Acme's passkeys", async () => {
	const page = await context.newPage();
	await page.goto("https://other.test/");
	await withDeviceAuthenticator(page);
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	// The browser refuses it, and vauly never offers anything.
	await expect(result(page)).toHaveText("SecurityError");
	await expect(page.locator("vauly-frame")).toHaveCount(0);
	await page.close();
});

test("locked, the prompt offers to unlock, then signs in", async () => {
	let popup = await openPopup();
	await popup.getByRole("button", { name: "Lock" }).click();
	await expect(
		popup.getByRole("heading", { name: "Unlock vauly" }),
	).toBeVisible();
	await popup.close();

	const page = await openAcme();
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	const card = prompt(page).getByRole("region", { name: "Passkey" });
	await expect(
		card.getByText("vauly is locked. Unlock it to use your passkeys here."),
	).toBeVisible();

	popup = await openPopup();
	await popup.getByLabel("Master password").fill(owner.password);
	await popup.getByRole("button", { name: "Unlock" }).click();
	await expect(popup.getByRole("list", { name: "All items" })).toBeVisible();
	await popup.close();

	await card.getByRole("button", { name: "Sign in as alex@acme.test" }).click();
	await expect(result(page)).toHaveText("Signed in as alex@acme.test");
	await page.close();
});
