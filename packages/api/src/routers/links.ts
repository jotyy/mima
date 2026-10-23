import { user } from "@mima/db/schema/auth";
import { item, setting, shareLink } from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure, publicProcedure } from "../index";
import { logEvent, newId, requireItemAccess } from "../lib";

const HOUR = 60 * 60 * 1000;

const linkDurations = {
	hour: HOUR,
	day: 24 * HOUR,
	week: 7 * 24 * HOUR,
	month: 30 * 24 * HOUR,
} as const;

/** A link still works until it expires, is used up, or its item goes to Recently deleted. */
const alive = (now: Date) =>
	and(
		gt(shareLink.expiresAt, now),
		or(isNull(shareLink.maxViews), lt(shareLink.views, shareLink.maxViews)),
	);

const linkId = z.object({ id: z.string().min(8).max(64) });

export const linksRouter = {
	/** Links to one item that still work. Dead ones are removed on the way. */
	list: memberProcedure
		.input(z.object({ itemId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireItemAccess(db, userId, input.itemId);
			const now = new Date();
			await db
				.delete(shareLink)
				.where(
					and(
						eq(shareLink.itemId, input.itemId),
						or(
							lt(shareLink.expiresAt, now),
							sql`${shareLink.views} >= ${shareLink.maxViews}`,
						),
					),
				);
			return db
				.select({
					id: shareLink.id,
					expiresAt: shareLink.expiresAt,
					maxViews: shareLink.maxViews,
					views: shareLink.views,
					createdAt: shareLink.createdAt,
					createdBy: shareLink.createdBy,
					createdByName: user.name,
				})
				.from(shareLink)
				.leftJoin(user, eq(user.id, shareLink.createdBy))
				.where(and(eq(shareLink.itemId, input.itemId), alive(now)))
				.orderBy(desc(shareLink.createdAt));
		}),

	create: memberProcedure
		.input(
			z.object({
				itemId: z.string(),
				data: z.string().min(20).max(64_000),
				expiresIn: z.enum(["hour", "day", "week", "month"]),
				once: z.boolean(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const target = await requireItemAccess(db, userId, input.itemId);
			const id = newId("lnk");
			const expiresAt = new Date(Date.now() + linkDurations[input.expiresIn]);
			await db.batch([
				db.insert(shareLink).values({
					id,
					itemId: input.itemId,
					data: input.data,
					createdBy: userId,
					expiresAt,
					maxViews: input.once ? 1 : null,
				}),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "linked",
					itemId: input.itemId,
					vaultId: target.vaultId,
					detail: `${input.expiresIn}${input.once ? " once" : ""}`,
				}),
			]);
			return { id, expiresAt };
		}),

	/** Anyone who can open the item can turn its links off. */
	revoke: memberProcedure.input(linkId).handler(async ({ context, input }) => {
		const { db, userId } = context;
		const [row] = await db
			.select()
			.from(shareLink)
			.where(eq(shareLink.id, input.id));
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Link not found" });
		const target = await requireItemAccess(db, userId, row.itemId);
		await db.batch([
			db.delete(shareLink).where(eq(shareLink.id, input.id)),
			logEvent(db, {
				actorType: "member",
				actorId: userId,
				action: "revoked",
				itemId: row.itemId,
				vaultId: target.vaultId,
				detail: "link",
			}),
		]);
	}),

	/** What the person holding the link sees before opening it. Doesn't count as a view. */
	peek: publicProcedure.input(linkId).handler(async ({ context, input }) => {
		const { db } = context;
		const [row] = await db
			.select({
				expiresAt: shareLink.expiresAt,
				maxViews: shareLink.maxViews,
				views: shareLink.views,
				sharedBy: user.name,
			})
			.from(shareLink)
			.innerJoin(item, eq(item.id, shareLink.itemId))
			.leftJoin(user, eq(user.id, shareLink.createdBy))
			.where(
				and(
					eq(shareLink.id, input.id),
					isNull(item.deletedAt),
					alive(new Date()),
				),
			);
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Link not found" });
		const [workspace] = await db
			.select({ value: setting.value })
			.from(setting)
			.where(eq(setting.key, "workspace_name"));
		return {
			sharedBy: row.sharedBy ?? "Someone",
			workspace: workspace?.value ?? "mima",
			expiresAt: row.expiresAt,
			viewsLeft: row.maxViews === null ? null : row.maxViews - row.views,
		};
	}),

	/** Counts a view and hands over the sealed copy. Only the #fragment can open it. */
	open: publicProcedure.input(linkId).handler(async ({ context, input }) => {
		const { db } = context;
		const now = new Date();
		const [live] = await db
			.select({ itemId: shareLink.itemId, vaultId: item.vaultId })
			.from(shareLink)
			.innerJoin(item, eq(item.id, shareLink.itemId))
			.where(and(eq(shareLink.id, input.id), isNull(item.deletedAt)));
		if (!live) throw new ORPCError("NOT_FOUND", { message: "Link not found" });
		// One statement checks and counts, so a one-view link can't be opened twice at once.
		const [row] = await db
			.update(shareLink)
			.set({ views: sql`${shareLink.views} + 1` })
			.where(and(eq(shareLink.id, input.id), alive(now)))
			.returning({ data: shareLink.data });
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Link not found" });
		await logEvent(db, {
			actorType: "link",
			actorId: input.id,
			action: "opened",
			itemId: live.itemId,
			vaultId: live.vaultId,
		});
		return { data: row.data };
	}),
};
