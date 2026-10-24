import { ORPCError } from "@orpc/server";
import type { Database } from "@vauly/db";
import {
	accessRequest,
	agent,
	agentGrant,
	attachment,
	attachmentChunk,
	item,
	member,
} from "@vauly/db/schema/vault";
import { and, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
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

/** How long a pass to download a granted item's files lasts. */
const FILE_PASS_MS = 15 * 60 * 1000;

async function hmac(secret: string, message: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(message),
	);
	return Array.from(new Uint8Array(signature), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

const passMessage = (agentId: string, fileId: string, until: number) =>
	`vauly/file-pass\n${agentId}\n${fileId}\n${until}`;

/**
 * The finished files on a granted item, each with a pass to download it: signed by the
 * server for this agent and file, good for FILE_PASS_MS, so a one-time grant still
 * lets the run that used it finish its downloads.
 */
async function grantedFiles(
	db: Database,
	secret: string,
	agentId: string,
	itemId: string,
) {
	const rows = await db
		.select({
			id: attachment.id,
			meta: attachment.meta,
			chunks: attachment.chunks,
		})
		.from(attachment)
		.where(and(eq(attachment.itemId, itemId), isNotNull(attachment.meta)));
	const until = Date.now() + FILE_PASS_MS;
	return Promise.all(
		rows.map(async (row) => ({
			id: row.id,
			meta: row.meta as string,
			chunks: row.chunks,
			token: `${row.id}.${until}.${await hmac(secret, passMessage(agentId, row.id, until))}`,
		})),
	);
}
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
 * For an item without a grant, or one that doesn't cover the files a run needs: its open
 * request, a recent denial, or a new request.
 */
async function ask(
	db: Database,
	agentId: string,
	{ id, target, pending, denied }: Lookup,
	command: string,
	files = false,
) {
	if (!target) return { itemId: id, status: "missing" as const };
	if (pending) {
		// Asked before without files: the person approving now sees that files go too.
		if (files && !pending.files) {
			await db
				.update(accessRequest)
				.set({ files: true })
				.where(eq(accessRequest.id, pending.id));
		}
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
			files,
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
		.input(
			z.object({
				itemIds,
				command: reason,
				/** The items whose files the run needs, because a reference names one. */
				files: z.array(z.string().max(40)).max(20).optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, agent: me } = context;
			const found = await lookup(db, me.id, input.itemIds);
			const withFiles = new Set(input.files ?? []);
			const results = [];
			for (const entry of found) {
				const { id, target, grant } = entry;
				const needsFiles = withFiles.has(id);
				if (target && grant && (!needsFiles || grant.files)) {
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
						...(needsFiles && {
							files: await grantedFiles(db, context.secret, me.id, id),
						}),
					});
					continue;
				}
				results.push(await ask(db, me.id, entry, input.command, needsFiles));
			}
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
			return Promise.all(
				found.map((entry) =>
					entry.target && entry.grant
						? { itemId: entry.id, status: "granted" as const }
						: ask(db, me.id, entry, input.reason),
				),
			);
		}),

	/** A chunk of a file, for a pass that resolve handed out. The first is logged. */
	file: agentProcedure
		.input(
			z.object({
				token: z.string().max(200),
				index: z.number().int().min(0),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, agent: me } = context;
			const [fileId = "", until = "", signature = ""] = input.token.split(".");
			const expected = await hmac(
				context.secret,
				passMessage(me.id, fileId, Number(until)),
			);
			if (!sameHash(signature, expected) || Number(until) < Date.now()) {
				throw new ORPCError("FORBIDDEN", {
					message: "That file pass expired. Run the command again.",
				});
			}
			const [row] = await db
				.select({
					data: attachmentChunk.data,
					itemId: attachment.itemId,
					vaultId: item.vaultId,
				})
				.from(attachmentChunk)
				.innerJoin(attachment, eq(attachment.id, attachmentChunk.attachmentId))
				.innerJoin(item, eq(item.id, attachment.itemId))
				.where(
					and(
						eq(attachmentChunk.attachmentId, fileId),
						eq(attachmentChunk.index, input.index),
						isNotNull(attachment.meta),
						isNull(item.deletedAt),
					),
				);
			if (!row) throw new ORPCError("NOT_FOUND", { message: "File not found" });
			if (input.index === 0) {
				await logEvent(db, {
					actorType: "agent",
					actorId: me.id,
					action: "downloaded",
					itemId: row.itemId,
					vaultId: row.vaultId,
					detail: `file:${fileId}`,
				});
			}
			return { data: row.data };
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
