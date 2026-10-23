import type { AccountKeys } from "@vauly/crypto";
import { useSyncExternalStore } from "react";

import { client } from "@/utils/orpc";

import { isOfflineError } from "./connection";
import { objectStore } from "./idb";
import {
	type Contents,
	type ItemRow,
	isFresh,
	openSnapshot,
	type Snapshot,
	sealSnapshot,
	type VaultRow,
} from "./snapshot";

export { OFFLINE_DAYS } from "./snapshot";

// The offline copy: what the API last returned for this person (their vaults, wrapped
// keys and item ciphertext), so the installed app can open items without a connection.
// The whole copy is sealed with a key wrapped to the account's own public key, so even
// its IDs and timestamps need the master password; only what unlocking needs stays
// readable. Like the passkey copy, it belongs to the session it was made in, and it's
// used for at most OFFLINE_DAYS.

// --- Storage ---------------------------------------------------------------------------

const request = objectStore("vauly-offline", "snapshots");

async function allSnapshots(): Promise<Snapshot[]> {
	try {
		return await request<Snapshot[]>("readonly", (store) => store.getAll());
	} catch {
		return [];
	}
}

/** Deletes copies: every one, or those `which` picks. */
export async function forgetSnapshots(
	which: (snapshot: Snapshot) => boolean = () => true,
) {
	const doomed = (await allSnapshots()).filter(which);
	for (const snapshot of doomed) {
		await request("readwrite", (store) =>
			store.delete(snapshot.accountId),
		).catch(() => undefined);
	}
	if (doomed.some((snapshot) => snapshot.syncedAt === state.syncedAt)) {
		update({ syncedAt: null });
	}
}

/** The newest copy still within OFFLINE_DAYS, for starting up without a connection. */
export async function latestSnapshot(): Promise<Snapshot | null> {
	await forgetSnapshots((snapshot) => !isFresh(snapshot));
	const [latest] = (await allSnapshots()).sort(
		(a, b) => b.syncedAt - a.syncedAt,
	);
	return latest ?? null;
}

// --- Whether to keep one on this device ----------------------------------------------

const SETTING = "vauly.offlineCopy";

export function offlineCopyEnabled() {
	try {
		return localStorage.getItem(SETTING) !== "off";
	} catch {
		return true;
	}
}

export async function setOfflineCopyEnabled(enabled: boolean) {
	try {
		localStorage.setItem(SETTING, enabled ? "on" : "off");
	} catch {
		// Then the choice lasts until the page reloads.
	}
	update({ enabled });
	if (enabled) await save();
	else await forgetSnapshots();
}

// --- The copy in use -------------------------------------------------------------------

type Account = { id: string; sessionId: string; keys: AccountKeys } & {
	profile: Contents["profile"];
};

let account: Account | null = null;
let latest: { vaults?: VaultRow[]; items?: ItemRow[] } = {};
/** The opened copy while unlocked, to fall back on when the server can't be reached. */
let opened: Promise<Contents | null> = Promise.resolve(null);

type State = { enabled: boolean; syncedAt: number | null };
let state: State = { enabled: offlineCopyEnabled(), syncedAt: null };
const listeners = new Set<() => void>();
function update(next: Partial<State>) {
	state = { ...state, ...next };
	for (const listener of listeners) listener();
}

/** Whether this device keeps a copy, and when it was last synced. */
export function useOfflineCopy() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => state,
		() => state,
	);
}

/** Who new copies are made for: set once the account and session are known online. */
export function setOfflineAccount(next: Account | null) {
	account = next;
	if (!next) latest = {};
	update({ enabled: offlineCopyEnabled() });
}

/** After unlocking: opens this account's copy, if there's one in reach. */
export function openOfflineCopy(accountId: string, privateKey: CryptoKey) {
	opened = (async () => {
		const snapshot = (await allSnapshots()).find(
			(candidate) => candidate.accountId === accountId,
		);
		if (!snapshot || !isFresh(snapshot)) return null;
		try {
			const contents = await openSnapshot(snapshot, privateKey);
			update({ syncedAt: snapshot.syncedAt });
			return contents;
		} catch {
			await forgetSnapshots((other) => other.accountId === accountId);
			return null;
		}
	})();
	return opened;
}

/** On lock: the opened copy goes, with the keys. */
export function closeOfflineCopy() {
	opened = Promise.resolve(null);
}

async function save() {
	const { vaults, items } = latest;
	if (!account || !vaults || !items || !offlineCopyEnabled()) return;
	try {
		const snapshot = await sealSnapshot(account, {
			profile: account.profile,
			vaults,
			items,
		});
		await request("readwrite", (store) => store.put(snapshot));
		update({ syncedAt: snapshot.syncedAt });
	} catch {
		// No IndexedDB (a private window, say): then there's simply no offline copy.
	}
}

/** The vaults this person can open: from the server, or from the copy when it's out of reach. */
export async function vaultRows(): Promise<VaultRow[]> {
	try {
		const rows = await client.vaults.list();
		latest = { ...latest, vaults: rows };
		return rows;
	} catch (err) {
		const copy = isOfflineError(err) ? await opened : null;
		if (copy) return copy.vaults;
		throw err;
	}
}

/** Every item in those vaults, the same way. A fresh list from the server updates the copy. */
export async function itemRows(): Promise<ItemRow[]> {
	try {
		const rows = await client.items.list();
		latest = { ...latest, items: rows };
		await save();
		return rows;
	} catch (err) {
		const copy = isOfflineError(err) ? await opened : null;
		if (copy) return copy.items;
		throw err;
	}
}
