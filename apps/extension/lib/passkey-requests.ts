import type { CreateRequest, GetRequest } from "./passkey";

// A site's passkey request while vauly's prompt is open, kept per tab in session storage
// so it outlives the background going to sleep. Only the background reads it; it holds the
// site's challenge, never a key, and it's forgotten after five minutes.

export const PENDING_MS = 5 * 60 * 1000;

export type Pending = {
	/** The page script's name for the request, to answer the right call. */
	id: string;
	/** The page's origin, as the browser reported it. */
	origin: string;
	rpId: string;
	/** The document that asked; the answer goes to it and no later page in the tab. */
	documentId?: string;
	at: number;
} & (
	| { kind: "create"; request: CreateRequest }
	| { kind: "get"; request: GetRequest }
);

const keyFor = (tabId: number) => `passkey:${tabId}`;

export async function getPending(tabId: number): Promise<Pending | null> {
	const key = keyFor(tabId);
	const stored = (await browser.storage.session.get(key))[key] as
		| Pending
		| undefined;
	if (!stored) return null;
	if (Date.now() - stored.at > PENDING_MS) {
		await dropPending(tabId);
		return null;
	}
	return stored;
}

export function savePending(tabId: number, pending: Pending) {
	return browser.storage.session.set({ [keyFor(tabId)]: pending });
}

export function dropPending(tabId: number) {
	return browser.storage.session.remove(keyFor(tabId));
}
