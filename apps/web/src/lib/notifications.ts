// What the service worker (src/sw.ts) does with a push and a tap on its notification.
// The server sends `{ title, body, url, tag }` (packages/api/src/push/notify.ts), which
// the browser has already decrypted; nothing here fetches anything.

export type PushNotice = {
	title: string;
	body: string;
	url: string;
	tag: string;
};

const ICON = "/pwa-192x192.png";

/** The notice in a push, or null for one that isn't vauly's. */
export function readNotice(text: string | null | undefined): PushNotice | null {
	try {
		const data = JSON.parse(text ?? "") as Partial<PushNotice>;
		if (typeof data.title !== "string" || typeof data.body !== "string")
			return null;
		return {
			title: data.title,
			body: data.body,
			url: typeof data.url === "string" ? data.url : "/",
			tag: typeof data.tag === "string" ? data.tag : "",
		};
	} catch {
		return null;
	}
}

/**
 * Shows a push as a notification. A later one with the same tag replaces it quietly, so
 * the same agent asking again doesn't buzz the phone again.
 */
export async function showNotice(
	registration: ServiceWorkerRegistration,
	text: string | null | undefined,
) {
	const notice = readNotice(text);
	if (!notice) return;
	await registration.showNotification(notice.title, {
		body: notice.body,
		icon: ICON,
		badge: ICON,
		data: { url: notice.url },
		...(notice.tag ? { tag: notice.tag } : {}),
	});
}

/** Where a tap goes: the app's own page that the notice names, and nowhere else. */
export function noticePath(data: unknown, origin: string) {
	const path = (data as { url?: unknown } | null)?.url;
	try {
		const url = new URL(typeof path === "string" ? path : "/", origin);
		const page = `${url.pathname}${url.search}`;
		// A path starting with two slashes would name another site wherever it's used.
		return url.origin === origin && !page.startsWith("//") ? page : "/";
	} catch {
		return "/";
	}
}

/** The message that tells an open vauly window to go to a page, without reloading it. */
export const OPEN_PAGE = "vauly:open-page";

type WindowLike = {
	url: string;
	focus: () => Promise<unknown>;
	postMessage: (message: unknown) => void;
};

/**
 * Opens the page for a tapped notification. A vauly window that's already open goes
 * there itself, so it stays unlocked; otherwise a new window opens on it.
 */
export async function openNotice(
	clients: {
		matchAll: (options: {
			type: "window";
			includeUncontrolled: boolean;
		}) => Promise<readonly unknown[]>;
		openWindow: (url: string) => Promise<unknown>;
	},
	origin: string,
	data: unknown,
) {
	const path = noticePath(data, origin);
	const windows = (await clients.matchAll({
		type: "window",
		includeUncontrolled: true,
	})) as WindowLike[];
	const open = windows.find((window) => new URL(window.url).origin === origin);
	if (!open) return clients.openWindow(`${origin}${path}`);
	await open.focus();
	open.postMessage({ type: OPEN_PAGE, path });
}
