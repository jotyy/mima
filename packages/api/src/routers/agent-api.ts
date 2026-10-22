import { accessRequest, agent, agentGrant, item } from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { publicProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";

const DENIAL_COOLDOWN = 10 * 60 * 1000;

function sameHash(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Called by `mima run` with `Authorization: Bearer <agentId>.<secret>`. The agent's
 * private key never leaves its machine; it only receives ciphertext it can open.
 */
const agentProcedure = publicProcedure.use(async ({ context, next }) => {
	const header = context.headers.get("authorization") ?? "";
	const match = /^Bearer (agt_[a-z0-9]+)\.([0-9a-f]{48})$/.exec(header);
	if (!match?.[1] || !match[2])
		throw new ORPCError("UNAUTHORIZED", { message: "Missing agent token" });
	const [row] = await context.db
		.select()
		.from(agent)
		.where(eq(agent.id, match[1]));
	if (!row || !sameHash(row.secretHash, await hashToken(match[2]))) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unknown agent token" });
	}
	if (!row.enabled)
		throw new ORPCError("FORBIDDEN", {
			message: "This agent is paused in mima",
		});
	if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
		throw new ORPCError("FORBIDDEN", {
			message: "This agent's access has expired",
		});
	}
	const host = context.headers.get("x-mima-host")?.slice(0, 80) ?? row.host;
	await context.db
		.update(agent)
		.set({ lastSeenAt: new Date(), host })
		.where(eq(agent.id, row.id));
	return next({ context: { agent: row } });
});

export const agentApiRouter = {
	whoami: agentProcedure.handler(({ context }) => ({
		id: context.agent.id,
		name: context.agent.name,
		publicKey: context.agent.publicKey,
	})),

	/**
	 * For each item: the sealed item and its key wrapped to this agent, or a pending
	 * request that a person approves in mima.
	 */
	resolve: agentProcedure
		.input(
			z.object({
				itemIds: z.array(z.string().max(40)).min(1).max(20),
				command: z.string().trim().min(1).max(200),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, agent: me } = context;
			const ids = [...new Set(input.itemIds)];
			const now = new Date();
			const [items, grants, requests] = await Promise.all([
				db
					.select()
					.from(item)
					.where(and(inArray(item.id, ids), isNull(item.deletedAt))),
				db
					.select()
					.from(agentGrant)
					.where(
						and(eq(agentGrant.agentId, me.id), inArray(agentGrant.itemId, ids)),
					),
				db
					.select()
					.from(accessRequest)
					.where(
						and(
							eq(accessRequest.agentId, me.id),
							inArray(accessRequest.itemId, ids),
						),
					),
			]);

			const results = [];
			for (const id of ids) {
				const target = items.find((row) => row.id === id);
				if (!target) {
					results.push({ itemId: id, status: "missing" as const });
					continue;
				}
				const grant = grants.find((row) => row.itemId === id);
				if (grant && (!grant.expiresAt || grant.expiresAt > now)) {
					if (grant.once)
						await db.delete(agentGrant).where(eq(agentGrant.id, grant.id));
					await logEvent(db, {
						actorType: "agent",
						actorId: me.id,
						action: "injected",
						itemId: id,
						vaultId: target.vaultId,
						detail: input.command,
					});
					results.push({
						itemId: id,
						status: "granted" as const,
						data: target.data,
						wrappedKey: grant.wrappedKey,
					});
					continue;
				}
				const mine = requests.filter((row) => row.itemId === id);
				const pending = mine.find((row) => row.status === "pending");
				if (pending) {
					results.push({
						itemId: id,
						status: "pending" as const,
						requestId: pending.id,
					});
					continue;
				}
				const recentDenial = mine.find(
					(row) =>
						row.status === "denied" &&
						row.decidedAt &&
						now.getTime() - row.decidedAt.getTime() < DENIAL_COOLDOWN,
				);
				if (recentDenial) {
					results.push({ itemId: id, status: "denied" as const });
					continue;
				}
				const requestId = newId("req");
				await db.batch([
					db.insert(accessRequest).values({
						id: requestId,
						agentId: me.id,
						itemId: id,
						command: input.command,
					}),
					logEvent(db, {
						actorType: "agent",
						actorId: me.id,
						action: "requested",
						itemId: id,
						vaultId: target.vaultId,
						detail: input.command,
					}),
				]);
				results.push({ itemId: id, status: "pending" as const, requestId });
			}
			return results;
		}),

	poll: agentProcedure
		.input(z.object({ requestIds: z.array(z.string().max(40)).min(1).max(20) }))
		.handler(async ({ context, input }) => {
			const rows = await context.db
				.select({ id: accessRequest.id, status: accessRequest.status })
				.from(accessRequest)
				.where(
					and(
						eq(accessRequest.agentId, context.agent.id),
						inArray(accessRequest.id, input.requestIds),
						gt(
							accessRequest.createdAt,
							new Date(Date.now() - 24 * 60 * 60 * 1000),
						),
					),
				);
			return rows;
		}),
};
