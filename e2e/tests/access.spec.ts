import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";
import { decodeAgentToken } from "@vauly/crypto";

import { API_URL } from "../playwright.config";
import {
	apiFromPage,
	createWorkspace,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// What the API refuses, whatever the app shows. The teammate can edit Engineering and
// only view Ops; the owner manages both, and Solo alone.

test.describe.configure({ mode: "serial" });

const CANT_CHANGE = "You can open this vault but not change it";
const MANAGERS_ONLY = "Only the vault's managers can do that";
// Shaped like ciphertext and wrapped keys; the API refuses before it would store them.
const sealed = "x".repeat(60);
const wrapped = "w".repeat(60);

const ids = {
	engineering: "",
	ops: "",
	solo: "",
	postgres: "",
	pager: "",
	wiki: "",
	oldPager: "",
	teammate: "",
	owner: "",
};
let ownerToken = "";
let teammateToken = "";

const param = (url: string, name: string) =>
	new URL(url, "http://localhost").searchParams.get(name) ?? "";

async function newVault(page: Page, name: string) {
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(name);
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
	return param(page.url(), "vault");
}

async function addItem(page: Page, name: string) {
	await page
		.getByRole("button", { name: /^(New item|Add your first item)$/ })
		.first()
		.click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill(name);
	await form.getByLabel("Value").fill(`${name.toLowerCase()}-example-only`);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	const link = page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: new RegExp(`^${name}`) });
	return param((await link.getAttribute("href")) ?? "", "id");
}

async function newAgent(page: Page, name: string) {
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "New agent" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill(name);
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	const token =
		/VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await dialog.getByRole("button", { name: "I've stored it" }).click();
	return token;
}

async function share(page: Page, vault: string, role: RegExp) {
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: `${vault} options` }).click();
	await page.getByRole("menuitem", { name: "Manage access" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByRole("combobox", { name: "What they can do" }).click();
	await page.getByRole("option", { name: role }).click();
	await dialog.getByRole("button", { name: "Give access" }).click();
	await expect(page.getByText(`can open ${vault}`)).toBeVisible();
	await page.keyboard.press("Escape");
}

/** Calls the agent API the way `vauly run` does. */
async function asAgent(
	request: APIRequestContext,
	token: string,
	path: string,
	input: unknown = null,
) {
	const { agentId, secret } = decodeAgentToken(token);
	const response = await request.post(`${API_URL}/rpc/agent/${path}`, {
		headers: { authorization: `Bearer ${agentId}.${secret}` },
		data: { json: input },
	});
	return { status: response.status(), body: await response.text() };
}

test.beforeAll(async ({ browser, request }) => {
	test.setTimeout(240_000);
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);

	ids.engineering = await newVault(page, "Engineering");
	ids.postgres = await addItem(page, "Postgres staging");
	ids.ops = await newVault(page, "Ops");
	ids.pager = await addItem(page, "Pager");
	ids.wiki = await addItem(page, "Ops wiki");
	ids.oldPager = await addItem(page, "Old pager");
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Delete item" }).click();
	await expect(
		page.getByText("Moved Old pager to Recently deleted"),
	).toBeVisible();
	ids.solo = await newVault(page, "Solo");

	ownerToken = await newAgent(page, "CI");

	// On Pager, which the teammate will only view: a share link, and CI allowed to use it.
	await sidebarLink(page, "Ops").click();
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: /^Pager/ })
		.click();
	await page.getByRole("button", { name: "Share a link" }).click();
	const linkDialog = page.getByRole("dialog");
	await linkDialog.getByRole("button", { name: "Create link" }).click();
	await linkDialog.getByRole("button", { name: "Done" }).click();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const ciGrant = page.getByRole("dialog");
	await ciGrant.getByRole("tab", { name: "Until I revoke it" }).click();
	await ciGrant.getByRole("button", { name: "Grant access" }).click();
	await expect(page.getByText("CI can use Pager")).toBeVisible();

	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const inviteUrl = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.getByRole("button", { name: "Done" }).click();

	const joining = await browser.newPage();
	await joining.goto(inviteUrl);
	await joining.getByLabel("Your name").fill(teammate.name);
	await joining.getByLabel("Master password").fill(teammate.password);
	await joining.getByLabel("Repeat it").fill(teammate.password);
	await joining
		.getByRole("button", { name: `Join ${owner.workspace}` })
		.click();
	await expect(sidebarLink(joining, "Private")).toBeVisible();

	await share(page, "Engineering", /^Can edit/);
	await share(page, "Ops", /^Can view/);
	const members = JSON.parse(await apiFromPage(page, "members/list")).json
		.members as { userId: string; name: string }[];
	ids.teammate = members.find((m) => m.name === teammate.name)?.userId ?? "";
	ids.owner = members.find((m) => m.name === owner.name)?.userId ?? "";
	await page.context().close();

	// The teammate's own agent, allowed to use Postgres staging until revoked.
	await joining.reload();
	await joining.getByLabel("Master password").fill(teammate.password);
	await joining.getByRole("button", { name: "Unlock", exact: true }).click();
	teammateToken = await newAgent(joining, "Mei's laptop");
	await sidebarLink(joining, "Engineering").click();
	await joining.getByRole("button", { name: "More actions" }).click();
	await joining.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const grant = joining.getByRole("dialog");
	await grant.getByRole("combobox", { name: "Agent" }).click();
	await joining.getByRole("option", { name: /Mei's laptop/ }).click();
	await grant.getByRole("tab", { name: "Until I revoke it" }).click();
	await grant.getByRole("button", { name: "Grant access" }).click();
	await expect(
		joining.getByText("Mei's laptop can use Postgres staging"),
	).toBeVisible();
	await joining.context().close();
});

test("someone who can only view a vault can't change what's in it", async ({
	page,
}) => {
	await signIn(page, teammate);
	const refusals = {
		"items/create": { vaultId: ids.ops, wrappedKey: wrapped, data: sealed },
		"items/import": {
			vaultId: ids.ops,
			items: [{ wrappedKey: wrapped, data: sealed }],
			total: 1,
		},
		"items/update": { id: ids.pager, revision: 1, data: sealed },
		"items/remove": { id: ids.pager },
		"items/restore": { id: ids.oldPager },
		"items/purge": { id: ids.oldPager },
		"links/list": { itemId: ids.pager },
		"links/create": {
			itemId: ids.pager,
			data: sealed,
			expiresIn: "hour",
			once: true,
		},
		"agents/grant": {
			agentId: decodeAgentToken(teammateToken).agentId,
			itemId: ids.pager,
			wrappedKey: wrapped,
			duration: "once",
		},
	};
	for (const [path, input] of Object.entries(refusals)) {
		expect(await apiFromPage(page, path, input), path).toContain(CANT_CHANGE);
	}
});

test("an editor can't move an item into a vault they can only view", async ({
	page,
}) => {
	await signIn(page, teammate);
	expect(
		await apiFromPage(page, "items/update", {
			id: ids.postgres,
			revision: 1,
			data: sealed,
			vaultId: ids.ops,
			wrappedKey: wrapped,
		}),
	).toContain(CANT_CHANGE);
});

test("agents' requests and share links stay with the people who can change an item", async ({
	page,
	browser,
	request,
}) => {
	// The owner's agent asks for the Ops wiki: the owner answers, the teammate never sees it.
	const asked = await asAgent(request, ownerToken, "resolve", {
		itemIds: [ids.wiki],
		command: "npm run docs",
	});
	expect(asked.status).toBe(200);
	const manager = await browser.newPage();
	await signIn(manager, owner);
	expect(await apiFromPage(manager, "requests/list")).toContain(ids.wiki);
	expect(
		await apiFromPage(manager, "links/list", { itemId: ids.pager }),
	).toContain("lnk_");
	await manager.context().close();

	await signIn(page, teammate);
	expect(JSON.parse(await apiFromPage(page, "requests/list")).json).toEqual([]);
	const events = JSON.parse(await apiFromPage(page, "events/list", {}))
		.json as {
		action: string;
		actorType: string;
		actorId: string;
		itemId: string | null;
	}[];
	const actions = events
		.filter((e) => e.itemId === ids.pager || e.itemId === ids.wiki)
		.map((e) => e.action);
	expect(actions).toContain("created");
	for (const hidden of ["requested", "linked", "granted"]) {
		expect(actions).not.toContain(hidden);
	}
	expect(events.filter((e) => e.actorType === "link")).toEqual([]);
	const agents = JSON.parse(await apiFromPage(page, "agents/list")).json as {
		grants: { itemId: string }[];
	}[];
	expect(
		agents.flatMap((a) => a.grants).some((g) => g.itemId === ids.pager),
	).toBe(false);
});

test("an editor can't share a vault or take anyone out of it", async ({
	page,
}) => {
	await signIn(page, teammate);
	expect(
		await apiFromPage(page, "vaults/share", {
			vaultId: ids.engineering,
			userId: ids.owner,
			wrappedKey: wrapped,
			role: "view",
		}),
	).toContain(MANAGERS_ONLY);
	expect(
		await apiFromPage(page, "vaults/unshare", {
			vaultId: ids.engineering,
			userId: ids.owner,
		}),
	).toContain(MANAGERS_ONLY);
});

test("the last manager can't leave a vault", async ({ page }) => {
	await signIn(page, owner);
	expect(
		await apiFromPage(page, "vaults/unshare", {
			vaultId: ids.engineering,
			userId: ids.owner,
		}),
	).toContain("Make someone else a manager of this vault first");
	expect(
		await apiFromPage(page, "vaults/unshare", {
			vaultId: ids.solo,
			userId: ids.owner,
		}),
	).toContain("Nobody else can open this vault");
});

test("an agent loses a vault with its owner, and stops when they leave", async ({
	page,
	request,
}) => {
	expect((await asAgent(request, teammateToken, "whoami")).status).toBe(200);
	const mine = decodeAgentToken(teammateToken).agentId;
	const grantsOf = async () => {
		const agents = JSON.parse(await apiFromPage(page, "agents/list")).json as {
			id: string;
			grants: { itemId: string }[];
		}[];
		return agents.find((a) => a.id === mine)?.grants ?? [];
	};

	await signIn(page, owner);
	expect((await grantsOf()).map((g) => g.itemId)).toEqual([ids.postgres]);
	expect(
		await apiFromPage(page, "vaults/unshare", {
			vaultId: ids.engineering,
			userId: ids.teammate,
		}),
	).not.toContain("message");
	expect(await grantsOf()).toEqual([]);

	expect(
		await apiFromPage(page, "members/remove", { userId: ids.teammate }),
	).not.toContain("message");
	const after = await asAgent(request, teammateToken, "whoami");
	expect(after.status).toBe(401);
	const agents = JSON.parse(await apiFromPage(page, "agents/list")).json as {
		id: string;
	}[];
	expect(agents.map((a) => a.id)).not.toContain(mine);
});
