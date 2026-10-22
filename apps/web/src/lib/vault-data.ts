import {
	encodeAgentToken,
	newDataKey,
	newKeypair,
	newSecret,
	openJson,
	sealJson,
	sha256Hex,
	unwrapKey,
	wrapKey,
	wrapKeyFor,
} from "@mima/crypto";
import {
	type QueryClient,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
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
};

export type VaultMeta = { name: string; description: string; tone: Tone };

type Rows<T extends (...args: never[]) => Promise<unknown>> = Awaited<
	ReturnType<T>
>;
type VaultRow = Rows<typeof client.vaults.list>[number];
type ItemRow = Rows<typeof client.items.list>[number];

export type Vault = VaultMeta &
	Omit<VaultRow, "encryptedMeta"> & { key: CryptoKey };
export type Item = ItemFields &
	Omit<ItemRow, "data" | "wrappedKey"> & {
		key: CryptoKey;
		strength?: Strength;
	};
export type Member = Rows<typeof client.members.list>["members"][number];
export type Invite = Rows<typeof client.members.list>["invites"][number];
export type Agent = Rows<typeof client.agents.list>[number];
export type AccessRequest = Rows<typeof client.requests.list>[number];
export type VaultEvent = Rows<typeof client.events.list>[number];
export type Duration = "once" | "hour" | "day" | "always";

export const itemReference = (item: { id: string }) => `mima://${item.id}`;

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

export function useItems() {
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
			return items
				.filter((item) => item !== null)
				.sort((a, b) => a.name.localeCompare(b.name));
		},
	});
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

			async updateItem(item: Item, fields: ItemFields, target?: Vault) {
				const moving = target && target.id !== item.vaultId;
				return after(
					client.items.update({
						id: item.id,
						revision: item.revision,
						data: await sealJson(item.key, fields),
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
			) =>
				after(
					client.vaults.share({
						vaultId: vault.id,
						userId: member.userId,
						wrappedKey: await wrapKeyFor(member.publicKey, vault.key),
					}),
				),

			unshareVault: (vault: Vault, userId: string) =>
				after(client.vaults.unshare({ vaultId: vault.id, userId })),

			invite: (email: string, role: "admin" | "member") =>
				after(client.members.invite({ email, role })),
			revokeInvite: (id: string) => after(client.members.revokeInvite({ id })),
			setRole: (userId: string, role: "admin" | "member") =>
				after(client.members.setRole({ userId, role })),
			removeMember: (userId: string) =>
				after(client.members.remove({ userId })),

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
