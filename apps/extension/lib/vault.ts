import type { AppRouterClient } from "@mima/api/routers/index";
import {
	deriveMasterKeys,
	fromBase64,
	importPrivateKey,
	newDataKey,
	open,
	openJson,
	sealJson,
	toBase64,
	unwrapKey,
	unwrapKeyFrom,
	wrapKey,
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

/** An entry with what it takes to change it: its key, revision and every field. */
export type EditableEntry = Entry & {
	vaultId: string;
	revision: number;
	key: CryptoKey;
	fields: Record<string, unknown> & { history?: PreviousSecret[] };
};

type PreviousSecret = { secret: string; until: string; by?: string };

export type VaultInfo = {
	id: string;
	name: string;
	personal: boolean;
	key: CryptoKey;
};

const HISTORY_LIMIT = 10;

export class WrongPasswordError extends Error {}

/** The password was right, and the account wants a code too: none yet, or a wrong one. */
export class TwoStepError extends Error {
	constructor(readonly wrongCode: boolean) {
		super(
			wrongCode
				? "That code didn't work."
				: "Enter the code from your authenticator app.",
		);
	}
}

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
	code?: string,
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
		token = await signIn(connection.server, connection.email, authKey, code);
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

async function signIn(
	server: string,
	email: string,
	authKey: string,
	code?: string,
) {
	const response = await fetch(`${server}/api/auth/sign-in/email`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(code ? { "x-mima-code": code } : {}),
		},
		body: JSON.stringify({ email, password: authKey }),
	});
	if (!response.ok) {
		const error = (await response.json().catch(() => ({}))) as {
			code?: string;
		};
		if (error.code === "TWO_FACTOR_REQUIRED") throw new TwoStepError(false);
		if (error.code === "TWO_FACTOR_WRONG") throw new TwoStepError(true);
		throw new WrongPasswordError();
	}
	const body = (await response.json()) as { token?: string };
	const token = response.headers.get("set-auth-token") ?? body.token;
	if (!token) throw new Error("The server didn't start a session");
	return token;
}

/** The vaults and every item the person can open, decrypted, except deleted ones. */
export async function loadVault(
	client: AppRouterClient,
	unlocked: Unlocked,
): Promise<{ vaults: VaultInfo[]; entries: EditableEntry[] }> {
	const privateKey = await importPrivateKey(fromBase64(unlocked.privateKey));
	const [vaultRows, rows] = await Promise.all([
		client.vaults.list(),
		client.items.list(),
	]);
	const vaults = await Promise.all(
		vaultRows.map(async (vault): Promise<VaultInfo> => {
			const key = await unwrapKeyFrom(
				privateKey,
				unlocked.publicKey,
				vault.wrappedKey,
			);
			const meta = await openJson<{ name: string }>(key, vault.encryptedMeta);
			return { id: vault.id, name: meta.name, personal: vault.personal, key };
		}),
	);
	const byId = new Map(vaults.map((vault) => [vault.id, vault]));
	const entries = await Promise.all(
		rows
			.filter((row) => !row.deletedAt)
			.map(async (row): Promise<EditableEntry | null> => {
				const vault = byId.get(row.vaultId);
				if (!vault) return null;
				const key = await unwrapKey(vault.key, row.wrappedKey);
				const fields = await openJson<EditableEntry["fields"]>(key, row.data);
				return {
					id: row.id,
					vault: vault.name,
					vaultId: vault.id,
					revision: row.revision,
					favorite: row.favorite,
					key,
					fields,
					kind: fields.kind as ItemKind,
					name: fields.name as string,
					username: fields.username as string | undefined,
					secret: fields.secret as string | undefined,
					url: fields.url as string | undefined,
					totp: fields.totp as string | undefined,
				};
			}),
	);
	return {
		vaults: vaults.sort(
			(a, b) =>
				Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name),
		),
		entries: entries
			.filter((entry) => entry !== null)
			.sort((a, b) => a.name.localeCompare(b.name)),
	};
}

/** Encrypts a new login on this device and adds it to the vault. */
export async function saveLogin(
	client: AppRouterClient,
	vault: VaultInfo,
	login: { name: string; username: string; password: string; url: string },
) {
	const key = await newDataKey();
	return client.items.create({
		vaultId: vault.id,
		wrappedKey: await wrapKey(vault.key, key),
		data: await sealJson(key, {
			kind: "login",
			name: login.name,
			username: login.username || undefined,
			secret: login.password,
			url: login.url,
		}),
	});
}

/** Replaces a login's password; the old one stays under Earlier passwords. */
export async function updatePassword(
	client: AppRouterClient,
	entry: EditableEntry,
	password: string,
	by: string,
) {
	const history = [
		...(entry.secret
			? [{ secret: entry.secret, until: new Date().toISOString(), by }]
			: []),
		...(entry.fields.history ?? []),
	].slice(0, HISTORY_LIMIT);
	return client.items.update({
		id: entry.id,
		revision: entry.revision,
		data: await sealJson(entry.key, {
			...entry.fields,
			secret: password,
			...(history.length ? { history } : {}),
		}),
	});
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
