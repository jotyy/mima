import { dropCapture, getCapture, offerFor, saveCapture } from "@/lib/capture";
import { getConnection, getUnlocked } from "@/lib/storage";
import { apiClient, hostOf, loadEntries } from "@/lib/vault";

type LoginMessage = { type: "mima:login"; username: string; password: string };

export default defineBackground(() => {
	// Checks every minute whether the extension has been idle long enough to lock, so the
	// unlocked key leaves memory even if the popup is never opened again.
	browser.alarms.create("auto-lock", { periodInMinutes: 1 });
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === "auto-lock") void getUnlocked();
	});

	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		const tabId = sender.tab?.id;
		// Only the content script, running in a page's top frame, sends logins.
		if (!isLogin(message) || tabId === undefined || sender.frameId !== 0)
			return;
		void remember(tabId, message, sender.url ?? sender.tab?.url ?? "");
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

function isLogin(message: unknown): message is LoginMessage {
	const m = message as Partial<LoginMessage> | null;
	return (
		m?.type === "mima:login" &&
		typeof m.username === "string" &&
		typeof m.password === "string" &&
		m.password.length > 0
	);
}

async function remember(tabId: number, login: LoginMessage, url: string) {
	const connection = await getConnection();
	const host = hostOf(url);
	// Nothing to save into yet, and never the master password typed into mima itself.
	if (!connection.server || !host) return;
	if (host === hostOf(connection.web) || host === hostOf(connection.server))
		return;

	const capture = {
		username: login.username,
		password: login.password,
		url: new URL(url).origin,
		at: Date.now(),
	};
	// When unlocked, a login that's saved already needs no offer.
	const unlocked = await getUnlocked();
	if (unlocked && connection.token) {
		const entries = await loadEntries(
			apiClient(connection.server, connection.token),
			unlocked,
		).catch(() => null);
		if (entries && !offerFor(capture, entries)) return dropCapture(tabId);
	}
	await saveCapture(tabId, capture);
}
