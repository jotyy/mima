import { ORPCError } from "@orpc/server";
import type { Database } from "@vauly/db";
import {
	accessRequest,
	agent,
	agentGrant,
	item,
	member,
} from "@vauly/db/schema/vault";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { publicProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";
import { approvalDeliveries } from "../push/notify";

const DENIAL_COOLDOWN = 10 * 60 * 1000;

function sameHash(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Called by `vauly run` with `Authorization: Bearer <agentId>.<secret>`. The agent's
 * private key never leaves its machine; it only receives ciphertext it can open.
 */
const agentProcedure = publicProcedure.use(async ({ context, next }) => {
	const header = context.headers.get("authorization") ?? "";
	const match = /^Bearer (agt_[a-z0-9]+)\.([0-9a-f]{48})$/.exec(header);
	if (!match?.[1] || !match[2])
		throw new ORPCError("UNAUTHORIZED", { message: "Missing agent token" });
	const [found] = await context.db
		.select({ agent, owner: member.userId })
		.from(agent)
		.leftJoin(member, eq(member.userId, agent.ownerId))
		.where(eq(agent.id, match[1]));
	const row = found?.agent;
	if (!row || !sameHash(row.secretHash, await hashToken(match[2]))) {
		throw new ORPCError("UNAUTHORIZED", { message: "Unknown agent token" });
	}
	// An agent acts for the person who made it, and stops when they leave.
	if (!found.owner) {
		throw new ORPCError("FORBIDDEN", {
			message: "This agent's owner is no longer in the workspace",
		});
	}
	if (!row.enabled)
		throw new ORPCError("FORBIDDEN", {
			message: "This agent is paused in vauly",
		});
	if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
		throw new ORPCError("FORBIDDEN", {
			message: "This agent's access has expired",
		});
	}
	const host = context.headers.get("x-vauly-host")?.slice(0, 80) ?? row.host;
	await context.db
		.update(agent)
		.set({ lastSeenAt: new Date(), host })
		.where(eq(agent.id, row.id));
	return next({ context: { agent: row } });
});

const itemIds = z.array(z.string().max(40)).min(1).max(20);
const reason = z.string().trim().min(1).max(200);

type Lookup = Awaited<ReturnType<typeof lookup>>[number];

/** Each item with this agent's live grant on it, and its open or recently denied request. */
async function lookup(db: Database, agentId: string, ids: string[]) {
	const unique = [...new Set(ids)];
	const now = new Date();
	const [items, grants, requests] = await Promise.all([
		db
			.select()
			.from(item)
			.where(and(inArray(item.id, unique), isNull(item.deletedAt))),
		db
			.select()
			.from(agentGrant)
			.where(
				and(
					eq(agentGrant.agentId, agentId),
					inArray(agentGrant.itemId, unique),
				),
			),
		db
			.select()
			.from(accessRequest)
			.where(
				and(
					eq(accessRequest.agentId, agentId),
					inArray(accessRequest.itemId, unique),
				),
			),
	]);
	return unique.map((id) => {
		const grant = grants.find(
			(row) => row.itemId === id && (!row.expiresAt || row.expiresAt > now),
		);
		const mine = requests.filter((row) => row.itemId === id);
		return {
			id,
			target: items.find((row) => row.id === id),
			grant,
			pending: mine.find((row) => row.status === "pending"),
			denied: mine.some(
				(row) =>
					row.status === "denied" &&
					row.decidedAt &&
					now.getTime() - row.decidedAt.getTime() < DENIAL_COOLDOWN,
			),
		};
	});
}

/**
 * For an item without a grant: its open request, a recent denial, or a new request. A new
 * one adds its vault to `asked`, for the notifications to the people who can approve it.
 */
async function ask(
	db: Database,
	agentId: string,
	{ id, target, pending, denied }: Lookup,
	command: string,
	asked: string[],
) {
	if (!target) return { itemId: id, status: "missing" as const };
	if (pending) {
		return { itemId: id, status: "pending" as const, requestId: pending.id };
	}
	if (denied) return { itemId: id, status: "denied" as const };
	const requestId = newId("req");
	await db.batch([
		db.insert(accessRequest).values({
			id: requestId,
			agentId,
			itemId: id,
			command,
		}),
		logEvent(db, {
			actorType: "agent",
			actorId: agentId,
			action: "requested",
			itemId: id,
			vaultId: target.vaultId,
			detail: command,
		}),
	]);
	asked.push(target.vaultId);
	return { itemId: id, status: "pending" as const, requestId };
}

export const agentApiRouter = {
	whoami: agentProcedure.handler(({ context }) => ({
		id: context.agent.id,
		name: context.agent.name,
		publicKey: context.agent.publicKey,
	})),

	/**
	 * For each item: the sealed item and its key wrapped to this agent, or a pending
	 * request that a person approves in vauly.
	 */
	resolve: agentProcedure
		.input(z.object({ itemIds, command: reason }))
		.handler(async ({ context, input }) => {
			const { db, agent: me } = context;
			const found = await lookup(db, me.id, input.itemIds);
			const results = [];
			const asked: string[] = [];
			for (const entry of found) {
				const { id, target, grant } = entry;
				if (target && grant) {
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
				results.push(await ask(db, me.id, entry, input.command, asked));
			}
			context.notify(approvalDeliveries(db, me, asked));
			return results;
		}),

	/**
	 * Whether this agent can use each item, and until when. Hands nothing over, logs
	 * nothing and doesn't use up a one-time grant, so `vauly mcp` can show what's ready.
	 */
	status: agentProcedure
		.input(z.object({ itemIds }))
		.handler(async ({ context, input }) => {
			const found = await lookup(context.db, context.agent.id, input.itemIds);
			return found.map(({ id, target, grant, pending, denied }) => {
				if (!target) return { itemId: id, status: "missing" as const };
				if (grant) {
					return {
						itemId: id,
						status: "granted" as const,
						once: grant.once,
						expiresAt: grant.expiresAt,
					};
				}
				if (pending) {
					return {
						itemId: id,
						status: "pending" as const,
						requestId: pending.id,
					};
				}
				if (denied) return { itemId: id, status: "denied" as const };
				return { itemId: id, status: "none" as const };
			});
		}),

	/** Asks a person to let this agent use items, with a reason they'll read. Hands nothing over. */
	request: agentProcedure
		.input(z.object({ itemIds, reason }))
		.handler(async ({ context, input }) => {
			const { db, agent: me } = context;
			const found = await lookup(db, me.id, input.itemIds);
			const asked: string[] = [];
			const results = await Promise.all(
				found.map((entry) =>
					entry.target && entry.grant
						? { itemId: entry.id, status: "granted" as const }
						: ask(db, me.id, entry, input.reason, asked),
				),
			);
			context.notify(approvalDeliveries(db, me, asked));
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
