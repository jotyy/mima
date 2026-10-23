import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	encodeAgentToken,
	keyToText,
	newDataKey,
	newKeypair,
	newSecret,
	openJson,
	sealJson,
	sha256Hex,
	unwrapKey,
	wrapKey,
	wrapKeyFor,
} from "@vauly/crypto";
import { useMemo } from "react";

import { client } from "@/utils/orpc";

import { useKeyring } from "./keyring";
import { passwordStrength, type Strength } from "./secrets";

// Queries decrypt on this device; actions encrypt before anything leaves it.

export type ItemKind = "login" | "api-key" | "note" | "ssh-key";
export type Tone = "blue" | "teal" | "amber" | "violet";

export type ItemFields = {
	kind: ItemKind;
	name: string;
	username?: string;
	secret?: string;
	url?: string;
	totp?: string;
	notes?: string;
	tags?: string[];
	/** Earlier passwords or values, newest first. Kept inside the encrypted item. */
	history?: PreviousSecret[];
};

export type PreviousSecret = { secret: string; until: string; by?: string };

const HISTORY_LIMIT = 10;

export type VaultMeta = { name: string; description: string; tone: Tone };

type Rows<T extends (...args: never[]) => Promise<unknown>> = Awaited<
	ReturnType<T>
>;
type VaultRow = Rows<typeof client.vaults.list>[number];
type ItemRow = Rows<typeof client.items.list>[number];

export type Vault = VaultMeta &
	Omit<VaultRow, "encryptedMeta"> & { key: CryptoKey };
/** What someone can do in a vault; the server enforces it. */
export type VaultRole = VaultRow["role"];

export const vaultRoles: { value: VaultRole; label: string; hint: string }[] = [
	{ value: "view", label: "Can view", hint: "Open, copy and fill items" },
	{
		value: "edit",
		label: "Can edit",
		hint: "Also add, change and delete items, and share them by link or with agents",
	},
	{
		value: "manage",
		label: "Can manage",
		hint: "Also choose who can open the vault, rename and delete it",
	},
];

export const roleLabel = (role: string | null | undefined) =>
	vaultRoles.find((choice) => choice.value === role)?.label ?? "Can view";

/** Whether this person can add, change and delete items in the vault. */
export const canEdit = (vault: { role: VaultRole } | undefined) =>
	vault?.role === "edit" || vault?.role === "manage";

/** Whether this person can share, rename and delete the vault. */
export const canManage = (vault: { role: VaultRole } | undefined) =>
	vault?.role === "manage";
export type Item = ItemFields &
	Omit<ItemRow, "data" | "wrappedKey"> & {
		key: CryptoKey;
		strength?: Strength;
		/** Other live logins with the same password. */
		reusedWith?: string[];
	};
export type Member = Rows<typeof client.members.list>["members"][number];
export type Invite = Rows<typeof client.members.list>["invites"][number];
export type Agent = Rows<typeof client.agents.list>[number];
export type AccessRequest = Rows<typeof client.requests.list>[number];
export type VaultEvent = Rows<typeof client.events.list>[number];
export type Duration = "once" | "hour" | "day" | "always";
export type ShareLink = Rows<typeof client.links.list>[number];
export type LinkDuration = "hour" | "day" | "week" | "month";
/** What a share link carries: a copy of the item without its history or tags. */
export type SharedItem = Pick<
	ItemFields,
	"kind" | "name" | "username" | "secret" | "url" | "totp" | "notes"
>;

export const itemReference = (item: { id: string }) => `vauly://${item.id}`;

/** Whether an item's name, username, address or tags contain the (lowercase) query. */
export const itemMatches = (item: Item, query: string) =>
	[item.name, item.username, item.url, ...(item.tags ?? [])].some((value) =>
		value?.toLowerCase().includes(query),
	);

function useVaultQueryOptions() {
	const keyring = useKeyring();
	return useMemo(
		() => ({
			queryKey: ["vault", "vaults", keyring.epoch] as const,
			enabled: keyring.status === "unlocked",
			queryFn: async (): Promise<Vault[]> => {
				const rows = await client.vaults.list();
				return Promise.all(
					rows.map(async ({ encryptedMeta, ...row }) => {
						const key = await keyring.vaultKey(row.id, row.wrappedKey);
						const meta = await openJson<VaultMeta>(key, encryptedMeta);
						return { ...row, ...meta, key };
					}),
				);
			},
		}),
		[keyring],
	);
}

export function useVaults() {
	return useQuery(useVaultQueryOptions());
}

/** Items that aren't in Recently deleted, sorted by name. */
export function useItems() {
	return useItemQuery((all) => all.filter((item) => !item.deletedAt));
}

/** Items in Recently deleted, most recently deleted first. */
export function useDeletedItems() {
	return useItemQuery((all) =>
		all
			.filter((item) => item.deletedAt)
			.sort(
				(a, b) =>
					new Date(b.deletedAt ?? 0).getTime() -
					new Date(a.deletedAt ?? 0).getTime(),
			),
	);
}

function useItemQuery(select: (all: Item[]) => Item[]) {
	const keyring = useKeyring();
	const queryClient = useQueryClient();
	const vaultOptions = useVaultQueryOptions();
	return useQuery({
		queryKey: ["vault", "items", keyring.epoch],
		enabled: keyring.status === "unlocked",
		queryFn: async (): Promise<Item[]> => {
			const [vaults, rows] = await Promise.all([
				queryClient.fetchQuery(vaultOptions),
				client.items.list(),
			]);
			const keys = new Map(vaults.map((vault) => [vault.id, vault.key]));
			const items = await Promise.all(
				rows.map(async ({ data, wrappedKey, ...row }): Promise<Item | null> => {
					const vaultKey = keys.get(row.vaultId);
					if (!vaultKey) return null;
					const key = await unwrapKey(vaultKey, wrappedKey);
					const fields = await openJson<ItemFields>(key, data);
					return {
						...row,
						...fields,
						key,
						strength:
							fields.kind === "login" && fields.secret
								? passwordStrength(fields.secret)
								: undefined,
					};
				}),
			);
			return markReused(
				items
					.filter((item) => item !== null)
					.sort((a, b) => a.name.localeCompare(b.name)),
			);
		},
		select,
	});
}

/** Points each login at the others that share its password. Deleted items don't count. */
function markReused(items: Item[]) {
	const bySecret = new Map<string, string[]>();
	for (const item of items) {
		if (item.kind !== "login" || !item.secret || item.deletedAt) continue;
		bySecret.set(item.secret, [...(bySecret.get(item.secret) ?? []), item.id]);
	}
	for (const item of items) {
		const ids = item.secret ? bySecret.get(item.secret) : undefined;
		if (ids && ids.length > 1 && !item.deletedAt) {
			item.reusedWith = ids.filter((id) => id !== item.id);
		}
	}
	return items;
}

const live = (ms: number) => ({
	refetchInterval: ms,
	refetchOnWindowFocus: true,
});

export function useMembers() {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "members"],
		enabled: status === "unlocked",
		queryFn: () => client.members.list(),
	});
}

/** Someone who could see an item's secret, then lost access, before it changed. */
export type Exposure = {
	people: { name: string; removalId: string; at: Date }[];
};

const DISMISSED_KEY = "vauly.dismissedRemovals";

function dismissedRemovals() {
	try {
		return new Set<string>(
			JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"),
		);
	} catch {
		return new Set<string>();
	}
}

/**
 * Items with a secret that someone could see before they were taken out of its vault, or
 * left the workspace, and that hasn't changed since. Keyed by item ID.
 */
export function useExposed() {
	const { status } = useKeyring();
	const items = useItems();
	const vaults = useVaults();
	const queryClient = useQueryClient();
	const removals = useQuery({
		queryKey: ["vault", "removals"],
		enabled: status === "unlocked",
		queryFn: () => client.events.removals(),
	});
	const dismissed = useQuery({
		queryKey: ["dismissed-removals"],
		queryFn: dismissedRemovals,
		staleTime: Number.POSITIVE_INFINITY,
	});

	const exposed = useMemo(() => {
		const result = new Map<string, Exposure>();
		const vaultsById = new Map((vaults.data ?? []).map((v) => [v.id, v]));
		for (const removal of removals.data ?? []) {
			if (dismissed.data?.has(removal.id)) continue;
			const vault = removal.vaultId ? vaultsById.get(removal.vaultId) : null;
			if (!vault || vault.personal) continue;
			// Back in the vault since: nothing is hidden from them.
			if (vault.members.some((m) => m.userId === removal.subjectId)) continue;
			const at = new Date(removal.createdAt);
			for (const item of items.data ?? []) {
				if (item.vaultId !== vault.id || !item.secret) continue;
				if (new Date(item.createdAt) > at) continue;
				const changed = item.history?.[0]?.until;
				if (changed && new Date(changed) > at) continue;
				const entry = result.get(item.id) ?? { people: [] };
				const name = removal.name ?? "Someone";
				// Removals come newest first; the earliest one for a person is what counts.
				entry.people = [
					...entry.people.filter((person) => person.name !== name),
					{ name, removalId: removal.id, at },
				];
				result.set(item.id, entry);
			}
		}
		return result;
	}, [removals.data, items.data, vaults.data, dismissed.data]);

	/** Stops pointing at these removals on this device. */
	const dismiss = (removalIds: string[]) => {
		const next = dismissedRemovals();
		for (const id of removalIds) next.add(id);
		try {
			localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
		} catch {
			// Then it comes back on the next visit.
		}
		queryClient.setQueryData(["dismissed-removals"], next);
	};

	/** People who were taken out of a vault: not newcomers waiting for access. */
	const removed = useMemo(
		() =>
			new Set(
				(removals.data ?? [])
					.map((removal) => removal.subjectId)
					.filter((id): id is string => Boolean(id)),
			),
		[removals.data],
	);

	return { exposed, dismiss, removed };
}

/** Share links to one item that still work. */
/** An item's share links, for people who can change it; others aren't shown them. */
export function useLinks(itemId: string, editable: boolean) {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "links", itemId],
		enabled: status === "unlocked" && editable,
		queryFn: () => client.links.list({ itemId }),
	});
}

export function useAgents() {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "agents"],
		enabled: status === "unlocked",
		queryFn: () => client.agents.list(),
		...live(15_000),
	});
}

export function useRequests() {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "requests"],
		enabled: status === "unlocked",
		queryFn: () => client.requests.list(),
		...live(4_000),
	});
}

export function useEvents() {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "events"],
		enabled: status === "unlocked",
		queryFn: () => client.events.list({ limit: 200 }),
		...live(15_000),
	});
}

/** What happened to one item, newest first. */
export function useItemEvents(itemId: string | undefined, limit = 6) {
	const { status } = useKeyring();
	return useQuery({
		queryKey: ["vault", "events", itemId, limit],
		enabled: status === "unlocked" && Boolean(itemId),
		queryFn: () => client.events.list({ limit, itemId }),
	});
}

export function useWorkspace() {
	return useQuery({
		queryKey: ["workspace"],
		queryFn: () => client.account.status(),
		staleTime: 60_000,
	});
}

const refresh = (queryClient: QueryClient) =>
	queryClient.invalidateQueries({ queryKey: ["vault"] });

export function useActions() {
	const queryClient = useQueryClient();
	const { me } = useKeyring();

	return useMemo(() => {
		const after = async <T>(work: Promise<T>) => {
			const result = await work;
			await refresh(queryClient);
			return result;
		};

		const cached = <T>(key: string[]) =>
			queryClient.getQueriesData<T>({ queryKey: key })[0]?.[1];

		return {
			async createItem(vault: Vault, fields: ItemFields) {
				const key = await newDataKey();
				return after(
					client.items.create({
						vaultId: vault.id,
						wrappedKey: await wrapKey(vault.key, key),
						data: await sealJson(key, fields),
					}),
				);
			},

			/** Encrypts every item on this device, then uploads them 100 at a time. */
			async importItems(
				vault: Vault,
				items: ItemFields[],
				onProgress?: (done: number) => void,
			) {
				for (let start = 0; start < items.length; start += 100) {
					const chunk = items.slice(start, start + 100);
					const sealed = await Promise.all(
						chunk.map(async (fields) => {
							const key = await newDataKey();
							return {
								wrappedKey: await wrapKey(vault.key, key),
								data: await sealJson(key, fields),
							};
						}),
					);
					const last = start + 100 >= items.length;
					await client.items.import({
						vaultId: vault.id,
						items: sealed,
						...(last && { total: items.length }),
					});
					onProgress?.(start + chunk.length);
				}
				await refresh(queryClient);
			},

			/** Saves new fields; a changed password or value joins the item's history. */
			async updateItem(item: Item, fields: ItemFields, target?: Vault) {
				const moving = target && target.id !== item.vaultId;
				const replaced = item.secret && fields.secret !== item.secret;
				const history = replaced
					? [
							{
								secret: item.secret as string,
								until: new Date().toISOString(),
								by: me?.name,
							},
							...(item.history ?? []),
						].slice(0, HISTORY_LIMIT)
					: item.history;
				return after(
					client.items.update({
						id: item.id,
						revision: item.revision,
						data: await sealJson(item.key, {
							...fields,
							...(history?.length ? { history } : {}),
						}),
						...(moving
							? {
									vaultId: target.id,
									wrappedKey: await wrapKey(target.key, item.key),
								}
							: {}),
					}),
				);
			},

			deleteItem: (item: Item) => after(client.items.remove({ id: item.id })),
			restoreItem: (item: Item) => after(client.items.restore({ id: item.id })),
			purgeItem: (item: Item) => after(client.items.purge({ id: item.id })),

			/** Seals a copy of the item with a new key that only the link itself carries. */
			async createLink(
				item: Item,
				options: { expiresIn: LinkDuration; once: boolean; totp: boolean },
			) {
				const key = await newDataKey();
				const shared: SharedItem = {
					kind: item.kind,
					name: item.name,
					username: item.username,
					secret: item.secret,
					url: item.url,
					notes: item.notes,
					totp: options.totp ? item.totp : undefined,
				};
				const { id, expiresAt } = await after(
					client.links.create({
						itemId: item.id,
						data: await sealJson(key, shared),
						expiresIn: options.expiresIn,
						once: options.once,
					}),
				);
				const url = `${window.location.origin}/s/${id}#${await keyToText(key)}`;
				return { url, expiresAt };
			},

			revokeLink: (id: string) => after(client.links.revoke({ id })),

			toggleFavorite: (item: Item) =>
				after(client.items.favorite({ id: item.id, value: !item.favorite })),

			/** Reveals and copies go to the audit log; failures here never block the person. */
			logUse(item: Item, action: "revealed" | "copied", field: string) {
				client.items
					.log({ id: item.id, action, field })
					.then(() =>
						queryClient.invalidateQueries({ queryKey: ["vault", "events"] }),
					)
					.catch(() => {});
			},

			async createVault(meta: VaultMeta) {
				if (!me) throw new Error("Locked");
				const key = await newDataKey();
				return after(
					client.vaults.create({
						encryptedMeta: await sealJson(key, meta),
						wrappedKey: await wrapKeyFor(me.keys.publicKey, key),
					}),
				);
			},

			updateVault: async (vault: Vault, meta: VaultMeta) =>
				after(
					client.vaults.update({
						id: vault.id,
						encryptedMeta: await sealJson(vault.key, meta),
					}),
				),

			deleteVault: (vault: Vault) =>
				after(client.vaults.remove({ id: vault.id })),

			shareVault: async (
				vault: Vault,
				member: { userId: string; publicKey: string },
				role: VaultRole,
			) =>
				after(
					client.vaults.share({
						vaultId: vault.id,
						userId: member.userId,
						wrappedKey: await wrapKeyFor(member.publicKey, vault.key),
						role,
					}),
				),

			setVaultRole: (vault: Vault, userId: string, role: VaultRole) =>
				after(client.vaults.setRole({ vaultId: vault.id, userId, role })),

			unshareVault: (vault: Vault, userId: string) =>
				after(client.vaults.unshare({ vaultId: vault.id, userId })),

			invite: (email: string, role: "admin" | "member") =>
				after(client.members.invite({ email, role })),
			revokeInvite: (id: string) => after(client.members.revokeInvite({ id })),
			setRole: (userId: string, role: "admin" | "member") =>
				after(client.members.setRole({ userId, role })),
			removeMember: (userId: string) =>
				after(client.members.remove({ userId })),
			resetTwoStep: (userId: string) =>
				after(client.members.resetTwoStep({ userId })),

			/** Returns the token, which is shown once: the private key exists nowhere else. */
			async createAgent(input: {
				name: string;
				kind: "mcp" | "cli" | "ci";
				expiresInDays: number | null;
			}) {
				const pair = await newKeypair();
				const secret = newSecret();
				const { id } = await client.agents.create({
					...input,
					publicKey: pair.publicKey,
					secretHash: await sha256Hex(secret),
				});
				await refresh(queryClient);
				return { id, token: encodeAgentToken(id, secret, pair.privateKeyRaw) };
			},

			updateAgent: (
				id: string,
				change: { enabled?: boolean; extendDays?: number },
			) => after(client.agents.update({ id, ...change })),
			deleteAgent: (id: string) => after(client.agents.remove({ id })),

			grant: async (agent: Agent, item: Item, duration: Duration) =>
				after(
					client.agents.grant({
						agentId: agent.id,
						itemId: item.id,
						wrappedKey: await wrapKeyFor(agent.publicKey, item.key),
						duration,
					}),
				),

			revoke: (agentId: string, itemId: string) =>
				after(client.agents.revoke({ agentId, itemId })),

			async approve(request: AccessRequest, duration: Duration) {
				const items = cached<Item[]>(["vault", "items"]);
				const agents = cached<Agent[]>(["vault", "agents"]);
				const item = items?.find((row) => row.id === request.itemId);
				const agent = agents?.find((row) => row.id === request.agentId);
				if (!item || !agent)
					throw new Error("Open the item's vault to approve this");
				return after(
					client.requests.approve({
						id: request.id,
						wrappedKey: await wrapKeyFor(agent.publicKey, item.key),
						duration,
					}),
				);
			},

			deny: (request: AccessRequest) =>
				after(client.requests.deny({ id: request.id })),
		};
	}, [queryClient, me]);
}

/** Readable message for anything an action throws. */
export function errorMessage(error: unknown) {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "Something went wrong";
}
