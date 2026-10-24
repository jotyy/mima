import { existsSync } from "node:fs";

import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

import { API_URL } from "../playwright.config";
import { vauly } from "./cli";
import {
	apiFromPage,
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const SECRET = "postgres://app:example-only-not-real@db.staging/app";
let token = "";
let reference = "";
/** The item the file tests use, with ca.pem on it. */
let caItem = "";

// The command checks the injected value itself and prints it, so the test sees both
// that it arrived and that vauly masked it in the output.
const check = [
	"sh",
	"-c",
	`test "$DATABASE_URL" = "${SECRET}" && echo MATCH; echo "value: $DATABASE_URL"`,
];

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await openAllItems(page);
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Postgres staging");
	await form.getByLabel("Value").fill(SECRET);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();

	// Agents stay out of the way: the reference lives behind the item's menu.
	await expect(page.getByText(/^vauly:\/\/itm_/)).toHaveCount(0);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	await expect(use.getByText("No agents yet.")).toBeVisible();
	reference = (
		(await use.getByText(/^vauly:\/\/itm_/).textContent()) ?? ""
	).trim();
	await page.close();
});

test("creating an agent shows its token once", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await expect(page).toHaveTitle("Agents · vauly");
	await expect(page.getByText("No agents yet")).toBeVisible();
	await page.getByRole("button", { name: "New agent" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Claude Code");
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	token = /VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	expect(token).toMatch(/^vauly_agent_agt_/);
	await dialog.getByRole("button", { name: "I've stored it" }).click();
	await expect(
		page.getByRole("region", { name: "Agents" }).getByText("Claude Code"),
	).toBeVisible();
});

test("vauly run waits for approval, then injects the value without revealing it", async ({
	page,
}) => {
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	await run.waitForStderr("needs approval");

	await signIn(page, owner);
	const needs = page.getByRole("region", { name: "Needs you" });
	await expect(
		needs.getByText("Claude Code wants Postgres staging"),
	).toBeVisible();
	await needs.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByText("Allowed Claude Code once")).toBeVisible();

	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
	expect(run.stdout()).toContain("value: <hidden>");
	expect(run.stdout()).not.toContain(SECRET);
});

test("allow once means once: the next run asks again, and deny stops it", async ({
	page,
}) => {
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	await run.waitForStderr("needs approval");

	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "Claude Code wants Postgres staging",
	});
	await card.getByRole("button", { name: "Deny" }).click();

	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("denied");
	expect(run.stdout()).not.toContain("MATCH");
});

test("an item granted until revoked works without asking", async ({ page }) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("tab", { name: "Until I revoke it" }).click();
	await dialog.getByRole("button", { name: "Grant access" }).click();
	await expect(
		page.getByText("Claude Code can use Postgres staging"),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Agents that can use it" }),
	).toBeVisible();
	await expect(
		page.getByRole("switch", { name: "Allow Claude Code" }),
	).toBeChecked();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
	expect(run.stderr()).not.toContain("needs approval");
});

test("pausing the agent stops its token right away", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("switch", { name: "Claude Code enabled" }).click();
	await expect(page.getByText("Claude Code is paused")).toBeVisible();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("paused");
});

test("a forged token is rejected", async () => {
	const forged = token.replace(/\.[0-9a-f]{48}\./, `.${"0".repeat(48)}.`);
	const run = vauly(["run", "--", "true"], {
		VAULY_TOKEN: forged,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("Unknown agent token");
});

test("a deleted item is out of reach for agents until it's restored", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("switch", { name: "Claude Code enabled" }).click();
	await expect(page.getByText("Claude Code is on")).toBeVisible();

	await openAllItems(page);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Delete item" }).click();
	const blocked = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await blocked.exit).toBe(1);
	expect(blocked.stderr()).toContain("doesn't exist or was deleted");

	// Restoring brings back the item with its grant, so the agent runs without asking.
	await page.getByRole("button", { name: "Undo" }).click();
	await expect(page.getByText("Restored Postgres staging")).toBeVisible();
	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("MATCH");
});

test("a file reference asks for the files, and hands the command a private path", async ({
	page,
}) => {
	const cert = "-----BEGIN EXAMPLE CERT-----\nexample-ca-for-agents\n";
	await signIn(page, owner);
	await openAllItems(page);
	// An item of its own: a denial a minute ago holds the other one back for a while.
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill("Internal CA");
	await form.getByLabel("Value").fill("example-ca-key");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.getByLabel("File to attach").setInputFiles({
		name: "ca.pem",
		mimeType: "application/x-pem-file",
		buffer: Buffer.from(cert),
	});
	await expect(
		page.getByText("Attached ca.pem", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	const fileReference = (
		(await use.getByText(/\/files\/ca\.pem$/).textContent()) ?? ""
	).trim();
	expect(fileReference).toMatch(/^vauly:\/\/itm_[a-z0-9]+\/files\/ca\.pem$/);
	caItem = /itm_[a-z0-9]+/.exec(fileReference)?.[0] ?? "";
	await page.keyboard.press("Escape");

	const run = vauly(
		[
			"run",
			"--",
			"sh",
			"-c",
			'echo "path: $CA_FILE"; ls -l "$CA_FILE"; cat "$CA_FILE"',
		],
		{ VAULY_TOKEN: token, CA_FILE: fileReference },
	);
	await run.waitForStderr("needs approval");
	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "Claude Code wants Internal CA",
	});
	await expect(
		card.getByText(/and writes its 1 file for the command/),
	).toBeVisible();
	await card.getByRole("button", { name: "Allow for 1 hour" }).click();

	expect(await run.exit).toBe(0);
	expect(run.stdout()).toContain("example-ca-for-agents");
	expect(run.stdout()).toMatch(/-rw-------/);
	const path = /path: (\S+)/.exec(run.stdout())?.[1] ?? "";
	expect(path).toMatch(/ca\.pem$/);
	// The file goes when the command ends.
	expect(existsSync(path)).toBe(false);

	await sidebarLink(page, "Activity").click();
	await expect(
		page
			.getByRole("list", { name: "Events" })
			.getByText("downloaded ca.pem from")
			.first(),
	).toBeVisible();
});

/** Calls the agent API with an agent's token, the way vauly run does. */
async function asAgent(
	request: APIRequestContext,
	agentToken: string,
	path: string,
	json: unknown,
) {
	const [id, secret] = agentToken.replace(/^vauly_agent_/, "").split(".");
	const response = await request.post(`${API_URL}/rpc/agent/${path}`, {
		headers: { authorization: `Bearer ${id}.${secret}` },
		data: { json },
	});
	return response.text();
}

type Resolved = {
	status: string;
	requestId?: string;
	files?: { id: string; token: string }[];
}[];
const resolve = async (request: APIRequestContext, files: boolean) =>
	(
		JSON.parse(
			await asAgent(request, token, "resolve", {
				itemIds: [caItem],
				command: "e2e check",
				...(files && { files: [caItem] }),
			}),
		) as { json: Resolved }
	).json[0];

test("a file pass works for its agent and grant only, and ends with the grant", async ({
	page,
	request,
}) => {
	const granted = await resolve(request, true);
	expect(granted?.status).toBe("granted");
	const pass = granted?.files?.[0]?.token ?? "";
	expect(
		await asAgent(request, token, "file", { token: pass, index: 0 }),
	).toContain('"data"');
	// A character in the middle of the signature: the last one has spare bits.
	const at = pass.length - 10;
	const tampered = `${pass.slice(0, at)}${pass[at] === "A" ? "B" : "A"}${pass.slice(at + 1)}`;
	expect(
		await asAgent(request, token, "file", { token: tampered, index: 0 }),
	).toContain("no longer good");

	// Another agent can't use it.
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "New agent" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Other agent");
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	const other =
		/VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await dialog.getByRole("button", { name: "I've stored it" }).click();
	expect(
		await asAgent(request, other, "file", { token: pass, index: 0 }),
	).toContain("no longer good");
	await apiFromPage(page, "agents/remove", {
		id: /agt_[a-z0-9]+/.exec(other)?.[0],
	});

	// Revoked, the pass stops working at once.
	const agentId = /agt_[a-z0-9]+/.exec(token)?.[0];
	await apiFromPage(page, "agents/revoke", { agentId, itemId: caItem });
	expect(
		await asAgent(request, token, "file", { token: pass, index: 0 }),
	).toContain("no longer good");
});

test("a grant without files doesn't reach them, and a changed request can't be approved", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: /^Internal CA/ })
		.click();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = page.getByRole("dialog");
	await use.getByRole("combobox", { name: "Agent" }).click();
	await page.getByRole("option", { name: "Claude Code" }).click();
	await use.getByRole("tab", { name: "Until I revoke it" }).click();
	await use.getByRole("button", { name: "Grant access" }).click();
	await expect(page.getByText("Claude Code can use Internal CA")).toBeVisible();

	expect((await resolve(request, false))?.status).toBe("granted");
	const asked = await resolve(request, true);
	expect(asked?.status).toBe("pending");

	// What the person saw didn't ask for files: approving that is refused.
	expect(
		await apiFromPage(page, "requests/approve", {
			id: asked?.requestId,
			wrappedKey: "x".repeat(40),
			duration: "once",
			files: false,
		}),
	).toContain("The request changed");
});

test("a one-time grant lets its run finish downloading, shows on the item until then, and turns off there", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	const card = page.getByRole("region", {
		name: "Claude Code wants Internal CA",
	});
	await card.getByRole("button", { name: "Allow once" }).click();
	await expect(
		page.getByText("Claude Code can use Internal CA once"),
	).toBeVisible();

	const granted = await resolve(request, true);
	expect(granted?.status).toBe("granted");
	expect((await resolve(request, true))?.status).toBe("pending");
	// The run that used the grant can still download what it was given.
	const pass = granted?.files?.[0]?.token;
	expect(
		await asAgent(request, token, "file", { token: pass, index: 0 }),
	).toContain('"data"');

	// Meanwhile the item shows it, and turning it off there ends the downloads at once.
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: /^Internal CA/ })
		.click();
	await expect(
		page.getByText(/^finishing a run until \d{1,2}:\d{2}/),
	).toBeVisible();
	await page.getByRole("switch", { name: "Allow Claude Code" }).click();
	await expect(
		page.getByText("Claude Code can no longer use Internal CA"),
	).toBeVisible();
	expect(
		await asAgent(request, token, "file", { token: pass, index: 0 }),
	).toContain("no longer good");
	await expect(page.getByText(/^finishing a run/)).toBeHidden();
});

test("the Overview says a request wants files, and approving it there covers the files shown", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	const needs = page.getByRole("region", { name: "Needs you" });
	await expect(needs.getByText("Claude Code wants Internal CA")).toBeVisible();
	await expect(needs.getByText(/with its 1 file/)).toBeVisible();
	await needs.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByText("Allowed Claude Code once")).toBeVisible();
	const granted = await resolve(request, true);
	expect(granted?.status).toBe("granted");
	expect(granted?.files).toHaveLength(1);
});

/** The pending request for the CA item's files, as the people who approve it see it. */
async function pendingFilesRequest(page: Page) {
	const { json } = JSON.parse(await apiFromPage(page, "requests/list")) as {
		json: { id: string; itemId: string; files: boolean }[];
	};
	return json.find((row) => row.itemId === caItem && row.files);
}

test("files finished after what the approver saw aren't covered", async ({
	page,
	request,
}) => {
	// The one-time grant is used up: the next run asks again.
	expect((await resolve(request, true))?.status).toBe("pending");
	await signIn(page, owner);
	const { json: files } = JSON.parse(await apiFromPage(page, "files/list")) as {
		json: { id: string; itemId: string; createdAt: string }[];
	};
	const seen = files.find((file) => file.itemId === caItem);
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: /^Internal CA/ })
		.click();
	await page.getByLabel("File to attach").setInputFiles({
		name: "ca2.pem",
		mimeType: "application/x-pem-file",
		buffer: Buffer.from("a second example cert"),
	});
	await expect(
		page.getByText("Attached ca2.pem", { exact: true }),
	).toBeVisible();

	// Approved as someone who saw only the first file.
	const pending = await pendingFilesRequest(page);
	expect(
		await apiFromPage(page, "requests/approve", {
			id: pending?.id,
			wrappedKey: "x".repeat(40),
			duration: "hour",
			files: true,
			filesThrough: new Date(seen?.createdAt ?? 0).getTime(),
		}),
	).not.toContain("error");
	expect((await resolve(request, true))?.status).toBe("pending");
});

test("a file uploading while access was granted isn't covered once it's finished", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	// Started before the approval...
	const { json: started } = JSON.parse(
		await apiFromPage(page, "files/create", {
			itemId: caItem,
			size: 3,
			chunks: 1,
		}),
	) as { json: { id: string } };
	await apiFromPage(page, "files/put", {
		id: started.id,
		index: 0,
		data: "A".repeat(28),
	});
	const pending = await pendingFilesRequest(page);
	await apiFromPage(page, "requests/approve", {
		id: pending?.id,
		wrappedKey: "x".repeat(40),
		duration: "hour",
		files: true,
		filesThrough: Date.now(),
	});
	expect((await resolve(request, true))?.status).toBe("granted");
	// ...and finished after it.
	await apiFromPage(page, "files/finish", {
		id: started.id,
		meta: "x".repeat(40),
	});
	expect((await resolve(request, true))?.status).toBe("pending");
	await apiFromPage(page, "files/remove", { id: started.id });
});

test("the activity log shows each agent run and decision", async ({ page }) => {
	await signIn(page, owner);
	await sidebarLink(page, "Activity").click();
	const events = page.getByRole("list", { name: "Events" });
	await expect(events.getByText("injected").first()).toBeVisible();
	await expect(events.getByText("asked to use").first()).toBeVisible();
	await expect(events.getByText("denied Claude Code access to")).toBeVisible();
	await expect(events.getByText("let Claude Code use").first()).toBeVisible();
	await expect(events.getByText("created the agent").first()).toBeVisible();
});

test("an agent can be extended, and deleting it stops its token for good", async ({
	page,
}) => {
	await signIn(page, owner);
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "Claude Code options" }).click();
	await page.getByRole("menuitem", { name: "Extend 7 days" }).click();
	await expect(page.getByText("Claude Code extended by 7 days")).toBeVisible();

	await page.getByRole("button", { name: "Claude Code options" }).click();
	await page.getByRole("menuitem", { name: "Delete agent" }).click();
	const confirm = page.getByRole("dialog");
	await expect(
		confirm.getByRole("heading", { name: "Delete Claude Code?" }),
	).toBeVisible();
	await confirm.getByRole("button", { name: "Delete agent" }).click();
	await expect(page.getByText("Deleted Claude Code")).toBeVisible();
	await expect(page.getByText("No agents yet")).toBeVisible();

	const run = vauly(["run", "--", ...check], {
		VAULY_TOKEN: token,
		DATABASE_URL: reference,
	});
	expect(await run.exit).toBe(1);
	expect(run.stderr()).toContain("Unknown agent token");
});
