import { user } from "@mima/db/schema/auth";
import { agent, event } from "@mima/db/schema/vault";
import { and, desc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { accessibleItemIds, myVaultIds, requireItemAccess } from "../lib";

export const eventsRouter = {
	/** Events about items and vaults you can open, plus workspace-wide ones (joins, invites). */
	list: memberProcedure
		.input(
			z
				.object({
					limit: z.number().int().min(1).max(500).default(100),
					/** Only what happened to this item. */
					itemId: z.string().optional(),
				})
				.default({ limit: 100 }),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			let where: SQL | undefined;
			if (input.itemId) {
				await requireItemAccess(db, userId, input.itemId, { deleted: true });
				where = eq(event.itemId, input.itemId);
			} else {
				const [itemIds, vaultIds] = await Promise.all([
					accessibleItemIds(db, userId, { deleted: true }),
					myVaultIds(db, userId),
				]);
				where = or(
					isNull(event.itemId),
					...(itemIds.length ? [inArray(event.itemId, itemIds)] : []),
					...(vaultIds.length ? [inArray(event.vaultId, vaultIds)] : []),
				);
			}
			const rows = await db
				.select()
				.from(event)
				.where(where)
				.orderBy(desc(event.createdAt))
				.limit(input.limit);
			const memberIds = [
				...new Set(
					rows.filter((r) => r.actorType === "member").map((r) => r.actorId),
				),
			];
			const agentIds = [
				...new Set(
					rows.filter((r) => r.actorType === "agent").map((r) => r.actorId),
				),
			];
			const [people, agents] = await Promise.all([
				memberIds.length
					? db
							.select({ id: user.id, name: user.name })
							.from(user)
							.where(inArray(user.id, memberIds))
					: Promise.resolve([]),
				agentIds.length
					? db
							.select({ id: agent.id, name: agent.name })
							.from(agent)
							.where(inArray(agent.id, agentIds))
					: Promise.resolve([]),
			]);
			const names = new Map(
				[...people, ...agents].map((row) => [row.id, row.name]),
			);
			return rows.map((row) => ({
				...row,
				actorName:
					row.actorType === "link"
						? "Someone with a link"
						: (names.get(row.actorId) ?? "Someone who left"),
			}));
		}),

	/**
	 * Everyone who lost access to one of your shared vaults, and when. The passwords they
	 * could see are worth changing.
	 */
	removals: memberProcedure.handler(async ({ context }) => {
		const { db, userId } = context;
		const vaultIds = await myVaultIds(db, userId);
		if (vaultIds.length === 0) return [];
		return db
			.select({
				id: event.id,
				vaultId: event.vaultId,
				subjectId: event.subjectId,
				name: event.detail,
				createdAt: event.createdAt,
			})
			.from(event)
			.where(
				and(
					eq(event.action, "revoked"),
					inArray(event.vaultId, vaultIds),
					// Item-level revokes are agents and share links, not people.
					isNull(event.itemId),
				),
			)
			.orderBy(desc(event.createdAt))
			.limit(500);
	}),
};
