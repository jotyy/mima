import type { AppRouterClient } from "@vauly/api/routers/index";
import { parseTotp, totpCode } from "@vauly/crypto";
import { logoDomain } from "@vauly/ui/lib/logos";

import {
	dropCapture,
	getCapture,
	offerFor,
	saveCapture,
	viewOf,
} from "@/lib/capture";
import { fillLoginForm } from "@/lib/fill";
import type {
	Done,
	FillResult,
	LoginMessage,
	MenuState,
	OfferState,
	PageMessage,
	Request,
} from "@/lib/messages";
import {
	type Connection,
	getConnection,
	getUnlocked,
	touch,
} from "@/lib/storage";
import {
	apiClient,
	type EditableEntry,
	hostOf,
	loadVault,
	matchesPage,
	saveLogin,
	updatePassword,
	type VaultInfo,
} from "@/lib/vault";

type Tab = { id: number; url: string };

export default defineBackground(() => {
	// Checks every minute whether the extension has been idle long enough to lock, so the
	// unlocked key leaves memory even if the popup is never opened again.
	browser.alarms.create("auto-lock", { periodInMinutes: 1 });
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === "auto-lock") void getUnlocked();
	});

	browser.runtime.onMessage.addListener((message: unknown, sender, reply) => {
		const tabId = sender.tab?.id;
		if (!isRequest(message) || tabId === undefined) return;
		const tab = { id: tabId, url: sender.tab?.url ?? "" };
		void answer(message, tab, {
			// Filling and saving come only from vauly's own frame; the page script just reports.
			fromFrame: Boolean(sender.url?.startsWith(browser.runtime.getURL("/"))),
			topFrame: sender.frameId === 0,
			url: sender.url ?? tab.url,
		}).then(reply, () => reply(null));
		return true;
	});

	// A tab's badge clears when it loads a new page; put it back while the login waits.
	browser.tabs.onUpdated.addListener((tabId, change) => {
		if (change.status !== "complete") return;
		void getCapture(tabId).then((capture) => {
			if (capture) void saveCapture(tabId, capture);
		});
	});
	browser.tabs.onRemoved.addListener((tabId) => void dropCapture(tabId));
});

function isRequest(message: unknown): message is Request {
	const type = (message as { type?: unknown } | null)?.type;
	return typeof type === "string" && type.startsWith("vauly:");
}

async function answer(
	request: Request,
	tab: Tab,
	sender: { fromFrame: boolean; topFrame: boolean; url: string },
): Promise<unknown> {
	switch (request.type) {
		case "vauly:login":
			if (sender.topFrame && !sender.fromFrame && isLogin(request))
				await remember(tab.id, request, sender.url);
			return null;
		case "vauly:field":
			return { show: await wantsMenu(tab.url) };
		case "vauly:offer?":
			return { show: (await offerState(tab)).status !== "none" };
	}
	if (!sender.fromFrame) return null;
	switch (request.type) {
		case "vauly:menu":
			return menuState(tab.url);
		case "vauly:fill":
			return fill(tab, request.id);
		case "vauly:offer":
			return offerState(tab);
		case "vauly:save":
			return save(tab, request);
		case "vauly:update":
			return update(tab);
		case "vauly:dismiss":
			await dropCapture(tab.id);
			return { ok: true } satisfies Done;
	}
}

function isLogin(message: LoginMessage) {
	return (
		typeof message.username === "string" &&
		typeof message.password === "string" &&
		message.password.length > 0
	);
}

// ── The vault, as the background sees it ────────────────────────────────────────────

type Open = {
	connection: Connection;
	client: AppRouterClient;
	vaults: VaultInfo[];
	entries: EditableEntry[];
};

/**
 * Focusing a field and opening the menu both need the vault; decrypting it once covers
 * both. It's held for a few seconds, and never once the extension has locked.
 */
let recent: { token: string; at: number; open: Open } | null = null;
const RECENT_MS = 15_000;

async function openVault(): Promise<Open | null> {
	const connection = await getConnection();
	const unlocked = await getUnlocked();
	if (!unlocked || !connection.server || !connection.token) {
		recent = null;
		return null;
	}
	if (
		recent?.token === connection.token &&
		Date.now() - recent.at < RECENT_MS
	) {
		return recent.open;
	}
	const client = apiClient(connection.server, connection.token);
	const loaded = await loadVault(client, unlocked);
	const open = { connection: connection as Connection, client, ...loaded };
	recent = { token: connection.token, at: Date.now(), open };
	return open;
}

/**
 * Whether vauly has anything to say on this site: never on vauly itself. Before the
 * extension is connected and signed in, it can only offer to do that.
 */
async function siteStatus(url: string) {
	const connection = await getConnection();
	const host = hostOf(url);
	if (!host) return "off";
	if (host === hostOf(connection.web) || host === hostOf(connection.server))
		return "off";
	return connection.server && connection.token ? "on" : "signed-out";
}

const fillable = (entry: EditableEntry, url: string) =>
	entry.kind === "login" && Boolean(entry.secret) && matchesPage(entry, url);

// ── The fill menu ───────────────────────────────────────────────────────────────────

async function wantsMenu(url: string) {
	const status = await siteStatus(url);
	if (status !== "on") return status === "signed-out";
	const open = await openVault().catch(() => null);
	// Locked, the menu offers to unlock; unlocked, it shows only when there's a login.
	if (!open) return !(await getUnlocked());
	return open.entries.some((entry) => fillable(entry, url));
}

async function menuState(url: string): Promise<MenuState> {
	if ((await siteStatus(url)) === "signed-out") return { status: "signed-out" };
	const open = await openVault();
	if (!open) return { status: "locked" };
	return {
		status: "ready",
		host: hostOf(url),
		logins: open.entries
			.filter((entry) => fillable(entry, url))
			.map((entry) => ({
				id: entry.id,
				name: entry.name,
				username: entry.username,
				logo: logoDomain(entry),
			})),
	};
}

async function fill(tab: Tab, id: string): Promise<FillResult> {
	const open = await openVault();
	const entry = open?.entries.find((e) => e.id === id);
	// Only ever a login saved for the site the tab is on.
	if (!open || !entry || !fillable(entry, tab.url)) return { ok: false };
	await touch();
	await browser.tabs
		.sendMessage(tab.id, { type: "vauly:filling" } satisfies PageMessage)
		.catch(() => {});
	const [result] = await browser.scripting.executeScript({
		target: { tabId: tab.id, frameIds: [0] },
		func: fillLoginForm,
		args: [entry.username ?? "", entry.secret ?? ""],
	});
	const filled = result?.result as { password: boolean } | undefined;
	if (!filled?.password) return { ok: false };
	void open.client.items
		.log({ id: entry.id, action: "filled", field: "login" })
		.catch(() => {});
	// The next page usually asks for the one-time code; the frame copies it.
	const config = entry.totp ? parseTotp(entry.totp) : null;
	const code = config
		? await totpCode(config).catch(() => undefined)
		: undefined;
	return { ok: true, code };
}

// ── Saving what was typed ───────────────────────────────────────────────────────────

async function remember(tabId: number, login: LoginMessage, url: string) {
	// Nothing to save into yet, and never the master password typed into vauly itself.
	if ((await siteStatus(url)) !== "on") return;
	const capture = {
		username: login.username,
		password: login.password,
		url: new URL(url).origin,
		at: Date.now(),
	};
	// When unlocked, a login that's saved already needs no offer.
	const open = await openVault().catch(() => null);
	if (open && !offerFor(capture, open.entries)) return dropCapture(tabId);
	await saveCapture(tabId, capture);
	await browser.tabs
		.sendMessage(tabId, { type: "vauly:offer-ready" } satisfies PageMessage)
		.catch(() => {});
}

async function offerState(tab: Tab): Promise<OfferState> {
	const capture = await getCapture(tab.id);
	if (!capture) return { status: "none" };
	const open = await openVault().catch(() => null);
	if (!open) return { status: "locked", host: hostOf(capture.url) };
	const offer = offerFor(capture, open.entries);
	if (!offer) {
		await dropCapture(tab.id);
		return { status: "none" };
	}
	return {
		status: "ready",
		offer: viewOf(offer),
		vaults: open.vaults
			.filter((vault) => vault.editable)
			.map(({ id, name }) => ({ id, name })),
	};
}

async function save(
	tab: Tab,
	request: { vaultId: string; name: string; username: string },
): Promise<Done> {
	const capture = await getCapture(tab.id);
	const open = await openVault();
	const vault = open?.vaults.find(
		(v) => v.id === request.vaultId && v.editable,
	);
	if (!capture || !open || !vault)
		return { ok: false, error: "That login isn't waiting any more." };
	try {
		await touch();
		await saveLogin(open.client, vault, {
			name: request.name.trim() || hostOf(capture.url),
			username: request.username.trim(),
			password: capture.password,
			url: capture.url,
		});
		await dropCapture(tab.id);
		recent = null;
		return { ok: true, message: `Saved to ${vault.name}` };
	} catch (err) {
		return { ok: false, error: (err as Error).message || "That didn't work" };
	}
}

async function update(tab: Tab): Promise<Done> {
	const capture = await getCapture(tab.id);
	const open = await openVault();
	const offer = capture && open ? offerFor(capture, open.entries) : null;
	if (!open || offer?.kind !== "update")
		return { ok: false, error: "That login isn't waiting any more." };
	try {
		await touch();
		const me = await open.client.account.me();
		await updatePassword(
			open.client,
			offer.entry,
			offer.capture.password,
			me.name,
		);
		await dropCapture(tab.id);
		recent = null;
		return { ok: true, message: "Password updated" };
	} catch (err) {
		return { ok: false, error: (err as Error).message || "That didn't work" };
	}
}
