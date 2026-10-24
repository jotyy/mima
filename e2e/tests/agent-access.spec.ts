import {
	type APIRequestContext,
	expect,
	type Page,
	test,
} from "@playwright/test";

import { API_URL } from "../playwright.config";
import {
	apiFromPage,
	createWorkspace,
	openAllItems,
	owner,
	resetWorkspace,
	sidebarLink,
	signIn,
	teammate,
} from "./helpers";

// An agent acts for the person who made it, so it can only use items in vaults they can
// open: moving an item where they can't follow takes it from the agent.

test.describe.configure({ mode: "serial" });

const ITEM = "Deploy key";
let token = "";
let itemId = "";

/** Calls the agent API with an agent's token, the way vauly run does. */
async function asAgent(
	request: APIRequestContext,
	path: string,
	json: unknown,
) {
	const [id, secret] = token.replace(/^vauly_agent_/, "").split(".");
	const response = await request.post(`${API_URL}/rpc/agent/${path}`, {
		headers: { authorization: `Bearer ${id}.${secret}` },
		data: { json },
	});
	return response.text();
}

type Resolved = { status: string; files?: { token: string }[] };
const resolved = async (request: APIRequestContext) =>
	(
		JSON.parse(
			await asAgent(request, "resolve", {
				itemIds: [itemId],
				command: "e2e check",
				files: [itemId],
			}),
		) as { json: Resolved[] }
	).json[0];
const resolve = async (request: APIRequestContext) =>
	(await resolved(request))?.status;
let pass = "";

async function openItem(page: Page) {
	await openAllItems(page);
	await page
		.getByRole("region", { name: "Items" })
		.getByRole("link", { name: new RegExp(`^${ITEM}`) })
		.click();
}

async function moveTo(page: Page, vault: string) {
	await openItem(page);
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: vault }).click();
	await expect(page.getByText(`Moved to ${vault}`)).toBeVisible();
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);
	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "New vault" }).click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Engineering");
	await dialog.getByRole("button", { name: "Create vault" }).click();
	await page.getByRole("button", { name: "Add your first item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill(ITEM);
	await form.getByLabel("Value").fill("example-deploy-key");
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.getByLabel("File to attach").setInputFiles({
		name: "deploy.pem",
		mimeType: "application/x-pem-file",
		buffer: Buffer.from("example deploy key file"),
	});
	await expect(
		page.getByText("Attached deploy.pem", { exact: true }),
	).toBeVisible();
	const { json: items } = JSON.parse(await apiFromPage(page, "items/list")) as {
		json: { id: string }[];
	};
	itemId = items[0]?.id ?? "";

	await sidebarLink(page, "Members").click();
	await page.getByLabel("Email to invite").fill(teammate.email);
	await page.getByRole("button", { name: "Invite" }).click();
	const inviteUrl = (
		(await page.getByTestId("invite-link").textContent()) ?? ""
	).trim();
	await page.keyboard.press("Escape");
	const joining = await browser.newPage();
	await joining.goto(inviteUrl);
	await joining.getByLabel("Your name").fill(teammate.name);
	await joining.getByLabel("Master password").fill(teammate.password);
	await joining.getByLabel("Repeat it").fill(teammate.password);
	await joining
		.getByRole("button", { name: `Join ${owner.workspace}` })
		.click();
	await expect(sidebarLink(joining, "Private")).toBeVisible();
	await joining.context().close();

	await sidebarLink(page, "Vaults").click();
	await page.getByRole("button", { name: "Engineering options" }).click();
	await page
		.getByRole("menuitem", { name: /^(Manage access|People)$/ })
		.click();
	const access = page.getByRole("dialog");
	await access.getByRole("combobox", { name: "What they can do" }).click();
	await page.getByRole("option", { name: /^Can edit/ }).click();
	await access.getByRole("button", { name: "Give access" }).click();
	await expect(
		page.getByText(`${teammate.name} can open Engineering`),
	).toBeVisible();
	await page.context().close();

	// The teammate makes an agent and lets it use the item.
	const mei = await browser.newPage();
	await signIn(mei, teammate);
	await sidebarLink(mei, "Agents").click();
	await mei.getByRole("button", { name: "New agent" }).first().click();
	const create = mei.getByRole("dialog");
	await create.getByLabel("Name").fill("Mei's agent");
	await create.getByRole("button", { name: "Create agent" }).click();
	const env = create.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	token = /VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await create.getByRole("button", { name: "I've stored it" }).click();
	await openItem(mei);
	await mei.getByRole("button", { name: "More actions" }).click();
	await mei.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const use = mei.getByRole("dialog");
	await use.getByRole("tab", { name: "Until I revoke it" }).click();
	await use.getByRole("checkbox", { name: /Its files too/ }).click();
	await use.getByRole("button", { name: "Grant access" }).click();
	await expect(mei.getByText(`Mei's agent can use ${ITEM}`)).toBeVisible();
	await mei.context().close();
});

test("an agent uses an item its owner can open, files and all", async ({
	request,
}) => {
	const result = await resolved(request);
	expect(result?.status).toBe("granted");
	pass = result?.files?.[0]?.token ?? "";
	expect(await asAgent(request, "file", { token: pass, index: 0 })).toContain(
		'"data"',
	);
});

test("moving the item where its owner can't follow takes it from the agent", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	await moveTo(page, "Private");
	expect(await resolve(request)).toBe("missing");
	// The file pass it had stops working too.
	expect(await asAgent(request, "file", { token: pass, index: 0 })).toContain(
		"no longer good",
	);
	await sidebarLink(page, "Activity").click();
	await expect(
		page
			.getByRole("list", { name: "Events" })
			.getByText(`revoked Mei's agent from`),
	).toBeVisible();
});

test("an agent can't be given an item its owner can't open", async ({
	page,
}) => {
	await signIn(page, owner);
	const { json: agents } = JSON.parse(
		await apiFromPage(page, "agents/list"),
	) as { json: { id: string; name: string }[] };
	const agent = agents.find((row) => row.name === "Mei's agent");
	expect(
		await apiFromPage(page, "agents/grant", {
			agentId: agent?.id,
			itemId,
			wrappedKey: "x".repeat(40),
			duration: "always",
		}),
	).toContain("acts for someone who can't open this vault");
});

test("moving it back doesn't bring the grant back: the agent asks again", async ({
	page,
	request,
}) => {
	await signIn(page, owner);
	await moveTo(page, "Engineering");
	expect(await resolve(request)).toBe("pending");
});

test("a request can't be approved once the agent's owner can't open the vault", async ({
	page,
}) => {
	await signIn(page, owner);
	const vaults = JSON.parse(await apiFromPage(page, "vaults/list")).json as {
		id: string;
		members: { userId: string; name: string }[];
	}[];
	const engineering = vaults.find((vault) => vault.members.length > 1);
	const mei = engineering?.members.find((m) => m.name === teammate.name);
	await apiFromPage(page, "vaults/unshare", {
		vaultId: engineering?.id,
		userId: mei?.userId,
	});
	const { json: requests } = JSON.parse(
		await apiFromPage(page, "requests/list"),
	) as { json: { id: string; files: boolean }[] };
	expect(requests).toHaveLength(1);
	expect(
		await apiFromPage(page, "requests/approve", {
			id: requests[0]?.id,
			wrappedKey: "x".repeat(40),
			duration: "once",
			files: requests[0]?.files,
			filesThrough: Date.now(),
		}),
	).toContain("acts for someone who can't open this vault");
});
