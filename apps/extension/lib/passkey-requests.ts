import type { CreateRequest, GetRequest } from "./passkey";

// The passkey request vauly's window is open for. There's one at a time, in session
// storage so it outlives the background going to sleep. Only extension pages read it; it
// holds the site's challenge, never a key, and it's forgotten after ten minutes.

/** The longest a site can make vauly's window wait, as the page script clamps it. */
export const PENDING_MS = 10 * 60 * 1000;

export type Pending = {
	/** The page script's name for the request, to answer the right call. */
	id: string;
	/** The tab and the document that asked; the answer goes to that document only. */
	tabId: number;
	documentId?: string;
	/** The window the tab is in, to bring it back to the front afterwards. */
	sourceWindowId?: number;
	/** vauly's own window, once it's open. */
	windowId?: number;
	/** The page's origin, as the browser reported it. */
	origin: string;
	rpId: string;
	at: number;
} & (
	| { kind: "create"; request: CreateRequest }
	| { kind: "get"; request: GetRequest }
);

const KEY = "passkey";

export async function getPending(): Promise<Pending | null> {
	const stored = (await browser.storage.session.get(KEY))[KEY] as
		| Pending
		| undefined;
	return stored ?? null;
}

export const isStale = (pending: Pending) =>
	Date.now() - pending.at > PENDING_MS;

export function savePending(pending: Pending) {
	return browser.storage.session.set({ [KEY]: pending });
}

export function dropPending() {
	return browser.storage.session.remove(KEY);
}
