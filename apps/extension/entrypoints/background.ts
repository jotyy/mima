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
	PasskeyOutcome,
	PasskeyState,
	Request,
} from "@/lib/messages";
import {
	canCreate,
	createPasskey,
	readCreateRequest,
	readGetRequest,
	rpProblem,
	signIn,
	usable,
} from "@/lib/passkey";
import {
	dropPending,
	getPending,
	type Pending,
	savePending,
} from "@/lib/passkey-requests";
import {
	type Connection,
	getConnection,
	getUnlocked,
	touch,
} from "@/lib/storage";
import {
	addPasskey,
	apiClient,
	type EditableEntry,
	hostOf,
	loadVault,
	matchesPage,
	saveLogin,
	savePasskeyLogin,
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
			documentId: sender.documentId,
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
	browser.tabs.onRemoved.addListener((tabId) => {
		void dropCapture(tabId);
		void dropPending(tabId);
	});
});

function isRequest(message: unknown): message is Request {
	const type = (message as { type?: unknown } | null)?.type;
	return typeof type === "string" && type.startsWith("vauly:");
}

type Sender = {
	fromFrame: boolean;
	topFrame: boolean;
	url: string;
	documentId?: string;
};

async function answer(
	request: Request,
	tab: Tab,
	sender: Sender,
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
		case "vauly:passkey":
			return passkeyAsked(tab, request, sender);
		case "vauly:passkey-abort": {
			const pending = await getPending(tab.id);
			if (sender.topFrame && !sender.fromFrame && pending?.id === request.id)
				await dropPending(tab.id);
			return null;
		}
		case "vauly:passkey-available":
			return {
				available: sender.topFrame && (await siteStatus(sender.url)) === "on",
			};
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
		case "vauly:passkey-state":
			return passkeyState(tab);
		case "vauly:passkey-save":
			return passkeySave(tab, request.vaultId);
		case "vauly:passkey-use":
			return passkeyUse(tab, request.itemId);
		case "vauly:passkey-decline":
			return passkeyDecline(tab, request.another);
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

// ── Passkeys ────────────────────────────────────────────────────────────────────────

// A site asks for a passkey through the script vauly adds to its page. Which site asked
// comes from the browser (the sender's URL), never from the page, and the answer goes back
// to the document that asked. Anything vauly can't or shouldn't do, it hands to the
// browser's own passkeys, so a site never ends up with less than it had without vauly.

const toBrowser: PasskeyOutcome = { next: "browser" };
const gone: Done = {
	ok: false,
	error: "The site isn't waiting for a passkey any more.",
};

async function passkeyAsked(
	tab: Tab,
	asked: { id: string; kind: "create" | "get"; request: unknown },
	sender: Sender,
): Promise<PasskeyOutcome> {
	// Only a page's own top frame, never vauly's frame or an embedded site.
	if (!sender.topFrame || sender.fromFrame) return toBrowser;
	if ((await siteStatus(sender.url)) !== "on") return toBrowser;
	const page = new URL(sender.url);
	const base = {
		id: asked.id,
		origin: page.origin,
		documentId: sender.documentId,
		at: Date.now(),
	};
	let pending: Pending;
	if (asked.kind === "create") {
		const request = readCreateRequest(asked.request);
		if (!request || !canCreate(request)) return toBrowser;
		pending = {
			...base,
			kind: "create",
			request,
			rpId: request.rp.id ?? page.hostname,
		};
	} else {
		const request = readGetRequest(asked.request);
		if (!request) return toBrowser;
		pending = {
			...base,
			kind: "get",
			request,
			rpId: request.rpId ?? page.hostname,
		};
	}
	// The browser refuses a site that asks for another site's passkeys, and so does vauly.
	if (rpProblem(page.origin, pending.rpId)) return toBrowser;
	if (pending.kind === "get") {
		// Unlocked, vauly knows whether it has a passkey here; locked, it asks to unlock.
		const open = await openVault().catch(() => null);
		if (open && passkeysFor(open.entries, pending).length === 0)
			return toBrowser;
	}
	await savePending(tab.id, pending);
	return { next: "prompt" };
}

/** The tab's waiting request, while the tab is still on the page that asked. */
async function pendingFor(tab: Tab) {
	const pending = await getPending(tab.id);
	if (!pending) return null;
	try {
		return new URL(tab.url).origin === pending.origin ? pending : null;
	} catch {
		return null;
	}
}

/** The items whose passkey can answer a sign-in request; viewers can use them too. */
function passkeysFor(
	entries: EditableEntry[],
	pending: Pending & { kind: "get" },
) {
	return entries.filter(
		(entry) =>
			entry.passkey &&
			usable([entry.passkey], pending.request, pending.rpId).length > 0,
	);
}

/** A passkey vauly has that the site asked not to make again. */
function excluded(entries: EditableEntry[], pending: Pending) {
	if (pending.kind !== "create") return undefined;
	const ids = (pending.request.excludeCredentials ?? []).map(
		(credential) => credential.id,
	);
	return entries.find(
		(entry) =>
			entry.passkey?.rpId === pending.rpId &&
			ids.includes(entry.passkey.credentialId),
	);
}

/** The saved login for this account that a new passkey joins, rather than a new item. */
function loginFor(
	entries: EditableEntry[],
	pending: Pending & { kind: "create" },
) {
	const name = pending.request.user.name?.toLowerCase();
	if (!name) return undefined;
	return entries.find(
		(entry) =>
			entry.kind === "login" &&
			entry.editable &&
			!entry.passkey &&
			(entry.username ?? "").toLowerCase() === name &&
			matchesPage(entry, pending.origin),
	);
}

async function passkeyState(tab: Tab): Promise<PasskeyState> {
	const pending = await pendingFor(tab);
	if (!pending) return { status: "none" };
	const open = await openVault().catch(() => null);
	if (!open)
		return { status: "locked", kind: pending.kind, rpId: pending.rpId };
	if (pending.kind === "get") {
		const passkeys = passkeysFor(open.entries, pending);
		// Unlocked just now, and there's none for this site after all.
		if (passkeys.length === 0) {
			await finish(tab, pending, toBrowser);
			return { status: "none" };
		}
		return {
			status: "get",
			rpId: pending.rpId,
			passkeys: passkeys.map((entry) => ({
				itemId: entry.id,
				name: entry.name,
				userName: entry.passkey?.userName ?? entry.username,
				logo: logoDomain(entry),
			})),
		};
	}
	const existing = excluded(open.entries, pending);
	if (existing)
		return { status: "exists", rpId: pending.rpId, name: existing.name };
	const into = loginFor(open.entries, pending);
	return {
		status: "create",
		rpId: pending.rpId,
		userName: pending.request.user.name ?? "",
		...(into && { into: { name: into.name, vault: into.vault } }),
		vaults: open.vaults
			.filter((vault) => vault.editable)
			.map(({ id, name }) => ({ id, name })),
	};
}

async function passkeySave(tab: Tab, vaultId: string): Promise<Done> {
	const pending = await pendingFor(tab);
	const open = await openVault();
	if (pending?.kind !== "create" || !open) return gone;
	if (excluded(open.entries, pending)) return gone;
	const into = loginFor(open.entries, pending);
	const vault = into
		? open.vaults.find((v) => v.id === into.vaultId)
		: open.vaults.find((v) => v.id === vaultId && v.editable);
	if (!vault) return { ok: false, error: "Pick a vault you can add to." };
	try {
		await touch();
		const { passkey, credential } = await createPasskey(
			pending.request,
			pending.origin,
		);
		// Kept in the vault before the site hears of it, so a site never has a passkey
		// vauly lost.
		if (into) {
			await addPasskey(open.client, into, passkey);
		} else {
			const page = new URL(pending.origin);
			await savePasskeyLogin(open.client, vault, {
				name: pending.rpId,
				username: pending.request.user.name,
				url:
					pending.rpId === page.hostname
						? page.origin
						: `https://${pending.rpId}`,
				passkey,
			});
		}
		recent = null;
		if (!(await finish(tab, pending, { next: "credential", credential })))
			return { ok: false, error: "The page closed before it got the passkey." };
		return { ok: true, message: `Passkey saved to ${vault.name}` };
	} catch (err) {
		return { ok: false, error: (err as Error).message || "That didn't work" };
	}
}

async function passkeyUse(tab: Tab, itemId: string): Promise<Done> {
	const pending = await pendingFor(tab);
	const open = await openVault();
	if (pending?.kind !== "get" || !open) return gone;
	const entry = passkeysFor(open.entries, pending).find(
		(candidate) => candidate.id === itemId,
	);
	if (!entry?.passkey) return gone;
	await touch();
	const credential = await signIn(
		entry.passkey,
		pending.request,
		pending.origin,
	);
	if (!(await finish(tab, pending, { next: "credential", credential })))
		return { ok: false, error: "The page closed before it got the passkey." };
	void open.client.items
		.log({ id: entry.id, action: "filled", field: "passkey" })
		.catch(() => {});
	return { ok: true, message: "Signed in with vauly" };
}

async function passkeyDecline(tab: Tab, another: boolean): Promise<Done> {
	const pending = await getPending(tab.id);
	if (!pending) return { ok: true };
	if (another) {
		await finish(tab, pending, toBrowser);
		return { ok: true };
	}
	// Turning down a passkey vauly has already is what the site's exclude list asks for.
	const open = await openVault().catch(() => null);
	await finish(
		tab,
		pending,
		open && excluded(open.entries, pending)
			? {
					next: "error",
					name: "InvalidStateError",
					message: "vauly has a passkey for this account already.",
				}
			: {
					next: "error",
					name: "NotAllowedError",
					message: "The request was turned down in vauly.",
				},
	);
	return { ok: true };
}

/** Answers the page that asked, and only it; false when that page is gone. */
async function finish(tab: Tab, pending: Pending, outcome: PasskeyOutcome) {
	await dropPending(tab.id);
	const message: PageMessage = {
		type: "vauly:passkey-done",
		id: pending.id,
		outcome,
	};
	try {
		const answered = await browser.tabs.sendMessage(
			tab.id,
			message,
			pending.documentId ? { documentId: pending.documentId } : { frameId: 0 },
		);
		return answered === true;
	} catch {
		return false;
	}
}
