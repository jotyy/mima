import type { AppRouterClient } from "@mima/api/routers/index";
import {
	deriveMasterKeys,
	fromBase64,
	importPrivateKey,
	open,
	openJson,
	toBase64,
	unwrapKey,
	unwrapKeyFrom,
} from "@mima/crypto";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";

import type { Connection, Unlocked } from "./storage";

// Talks to the mima API and decrypts on this device, like the web app does.

export type ItemKind = "login" | "api-key" | "note" | "ssh-key";

export type Entry = {
	id: string;
	vault: string;
	kind: ItemKind;
	name: string;
	username?: string;
	secret?: string;
	url?: string;
	totp?: string;
	favorite: boolean;
};

export class WrongPasswordError extends Error {}

export function apiClient(server: string, token?: string): AppRouterClient {
	const link = new RPCLink({
		url: `${server}/rpc`,
		fetch(url, options) {
			const headers = new Headers((options as RequestInit).headers);
			if (token) headers.set("Authorization", `Bearer ${token}`);
			return fetch(url, { ...options, headers });
		},
	});
	return createORPCClient(link);
}

/**
 * Finds the API from the address someone types: the web app's /mima.json names it. An
 * API address works too.
 */
export async function findServer(address: string) {
	const trimmed = address.trim().replace(/\/+$/, "");
	const web = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const response = await fetch(`${web}/mima.json`);
		const { server } = (await response.json()) as { server?: string };
		if (response.ok && server)
			return { web, server: server.replace(/\/+$/, "") };
	} catch {
		// Not the web app; maybe it's the API itself.
	}
	try {
		// Only mima's API answers this with {"ok":true}; any other site's page doesn't count.
		const response = await fetch(`${web}/api/auth/ok`);
		const body = (await response.json()) as { ok?: boolean };
		if (response.ok && body.ok === true) return { web, server: web };
	} catch {
		// Fall through.
	}
	throw new Error(
		"There's no mima at that address. Use the address you open mima at.",
	);
}

/**
 * Signs in if needed and unlocks: derives the keys from the master password, then opens
 * the private key. Returns what to remember.
 */
export async function unlock(
	connection: Pick<Connection, "server" | "email"> & { token?: string },
	password: string,
) {
	const anonymous = apiClient(connection.server);
	const { kdfSalt, kdfIterations } = await anonymous.account.prelogin({
		email: connection.email,
	});
	const { authKey, wrapKey } = await deriveMasterKeys(
		password,
		kdfSalt,
		kdfIterations,
	);

	let token = connection.token;
	let me = token
		? await apiClient(connection.server, token)
				.account.me()
				.catch(() => null)
		: null;
	if (!me) {
		token = await signIn(connection.server, connection.email, authKey);
		me = await apiClient(connection.server, token).account.me();
	}

	let privateKey: Uint8Array;
	try {
		privateKey = await open(wrapKey, me.keys.encryptedPrivateKey);
	} catch {
		throw new WrongPasswordError();
	}
	return {
		token: token as string,
		privateKey: toBase64(privateKey),
		publicKey: me.keys.publicKey,
	};
}

async function signIn(server: string, email: string, authKey: string) {
	const response = await fetch(`${server}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: authKey }),
	});
	if (!response.ok) throw new WrongPasswordError();
	const body = (await response.json()) as { token?: string };
	const token = response.headers.get("set-auth-token") ?? body.token;
	if (!token) throw new Error("The server didn't start a session");
	return token;
}

/** Every item the person can open, decrypted, except those in Recently deleted. */
export async function loadEntries(
	client: AppRouterClient,
	unlocked: Unlocked,
): Promise<Entry[]> {
	const privateKey = await importPrivateKey(fromBase64(unlocked.privateKey));
	const [vaults, rows] = await Promise.all([
		client.vaults.list(),
		client.items.list(),
	]);
	const keys = new Map<string, { key: CryptoKey; name: string }>();
	await Promise.all(
		vaults.map(async (vault) => {
			const key = await unwrapKeyFrom(
				privateKey,
				unlocked.publicKey,
				vault.wrappedKey,
			);
			const meta = await openJson<{ name: string }>(key, vault.encryptedMeta);
			keys.set(vault.id, { key, name: meta.name });
		}),
	);
	const entries = await Promise.all(
		rows
			.filter((row) => !row.deletedAt)
			.map(async (row): Promise<Entry | null> => {
				const vault = keys.get(row.vaultId);
				if (!vault) return null;
				const itemKey = await unwrapKey(vault.key, row.wrappedKey);
				const fields = await openJson<Omit<Entry, "id" | "vault" | "favorite">>(
					itemKey,
					row.data,
				);
				return {
					id: row.id,
					vault: vault.name,
					favorite: row.favorite,
					kind: fields.kind,
					name: fields.name,
					username: fields.username,
					secret: fields.secret,
					url: fields.url,
					totp: fields.totp,
				};
			}),
	);
	return entries
		.filter((entry) => entry !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when the item belongs to the page: same host, or the page is on a subdomain of it. */
export function matchesPage(entry: Entry, pageUrl: string | undefined) {
	const page = hostOf(pageUrl);
	const item = hostOf(entry.url);
	if (!page || !item) return false;
	return page === item || page.endsWith(`.${item}`);
}

export function hostOf(url: string | undefined) {
	if (!url) return "";
	try {
		const { protocol, hostname } = new URL(url);
		if (protocol !== "http:" && protocol !== "https:") return "";
		return hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}
