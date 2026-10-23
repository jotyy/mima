import { user } from "@vauly/db/schema/auth";
import { agent, type EventAction, event } from "@vauly/db/schema/vault";
import {
	and,
	desc,
	eq,
	inArray,
	isNull,
	ne,
	notInArray,
	or,
	type SQL,
} from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import {
	accessibleItemIds,
	myVaultIds,
	requireItemAccess,
	requireVaultAccess,
} from "../lib";

/** About agents and share links, which only people who can change an item handle. */
const editorsOnly: EventAction[] = [
	"requested",
	"approved",
	"denied",
	"granted",
	"injected",
	"linked",
	"opened",
];

/** Everything someone who can only view a vault may see in its log. */
const forViewers = and(
	notInArray(event.action, editorsOnly),
	// Revoking on an item means an agent or a link; on a vault, a person.
	or(ne(event.action, "revoked"), isNull(event.itemId)),
);

export const eventsRouter = {
	/**
	 * Events about vaults you can open and their items, workspace-wide ones (joins, invites),
	 * and what you did yourself. In a vault you can only view, agents and links stay out.
	 */
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
				const target = await requireItemAccess(db, userId, input.itemId, {
					deleted: true,
				});
				const access = await requireVaultAccess(db, userId, target.vaultId);
				where = and(
					eq(event.itemId, input.itemId),
					access.role === "view" ? forViewers : undefined,
				);
			} else {
				const [vaultIds, editVaultIds, itemIds, editItemIds] =
					await Promise.all([
						myVaultIds(db, userId),
						myVaultIds(db, userId, "edit"),
						accessibleItemIds(db, userId, { deleted: true }),
						accessibleItemIds(db, userId, { deleted: true, role: "edit" }),
					]);
				const viewOnly = (all: string[], editable: string[]) =>
					all.filter((id) => !editable.includes(id));
				where = or(
					and(isNull(event.itemId), isNull(event.vaultId)),
					and(eq(event.actorType, "member"), eq(event.actorId, userId)),
					inArray(event.vaultId, editVaultIds),
					inArray(event.itemId, editItemIds),
					and(
						or(
							inArray(event.vaultId, viewOnly(vaultIds, editVaultIds)),
							inArray(event.itemId, viewOnly(itemIds, editItemIds)),
						),
						forViewers,
					),
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
				// A link's ID opens it, so it isn't handed out with its events.
				actorId: row.actorType === "link" ? "" : row.actorId,
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
					// Taken out by someone else, or gone with their own account.
					inArray(event.action, ["revoked", "left"]),
					inArray(event.vaultId, vaultIds),
					// Item-level revokes are agents and share links, not people.
					isNull(event.itemId),
				),
			)
			.orderBy(desc(event.createdAt))
			.limit(500);
	}),
};
