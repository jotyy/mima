import { user } from "@mima/db/schema/auth";
import { agent, event } from "@mima/db/schema/vault";
import { desc, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { accessibleItemIds, myVaultIds } from "../lib";

export const eventsRouter = {
	/** Events about items and vaults you can open, plus workspace-wide ones (joins, invites). */
	list: memberProcedure
		.input(
			z
				.object({ limit: z.number().int().min(1).max(500).default(100) })
				.default({ limit: 100 }),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const [itemIds, vaultIds] = await Promise.all([
				accessibleItemIds(db, userId),
				myVaultIds(db, userId),
			]);
			const visible = [
				isNull(event.itemId),
				...(itemIds.length ? [inArray(event.itemId, itemIds)] : []),
				...(vaultIds.length ? [inArray(event.vaultId, vaultIds)] : []),
			];
			const rows = await db
				.select()
				.from(event)
				.where(or(...visible))
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
				actorName: names.get(row.actorId) ?? "Someone who left",
			}));
		}),
};
