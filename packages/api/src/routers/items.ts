import { favorite, item } from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import {
	logEvent,
	myVaultIds,
	newId,
	requireItemAccess,
	requireVaultAccess,
} from "../lib";

const data = z.string().min(20).max(64_000);
const wrapped = z.string().min(20).max(1_000);

export const itemsRouter = {
	list: memberProcedure.handler(async ({ context }) => {
		const { db, userId } = context;
		const vaultIds = await myVaultIds(db, userId);
		if (vaultIds.length === 0) return [];
		const [rows, favorites] = await Promise.all([
			db.select().from(item).where(inArray(item.vaultId, vaultIds)),
			db
				.select({ itemId: favorite.itemId })
				.from(favorite)
				.where(eq(favorite.userId, userId)),
		]);
		const favored = new Set(favorites.map((f) => f.itemId));
		return rows.map((row) => ({ ...row, favorite: favored.has(row.id) }));
	}),

	create: memberProcedure
		.input(z.object({ vaultId: z.string(), wrappedKey: wrapped, data }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId);
			const id = newId("itm");
			await db.batch([
				db.insert(item).values({
					id,
					vaultId: input.vaultId,
					wrappedKey: input.wrappedKey,
					data: input.data,
					createdBy: userId,
					updatedBy: userId,
					updatedAt: new Date(),
				}),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "created",
					itemId: id,
					vaultId: input.vaultId,
				}),
			]);
			return { id };
		}),

	/**
	 * Adds many items encrypted on the device, sent in chunks of up to 100. The last chunk
	 * carries `total`, which logs one "imported" event for the whole file.
	 */
	import: memberProcedure
		.input(
			z.object({
				vaultId: z.string(),
				items: z
					.array(z.object({ wrappedKey: wrapped, data }))
					.min(1)
					.max(100),
				total: z.number().int().positive().optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId);
			const now = new Date();
			const rows = input.items.map((entry) => ({
				id: newId("itm"),
				vaultId: input.vaultId,
				wrappedKey: entry.wrappedKey,
				data: entry.data,
				createdBy: userId,
				updatedBy: userId,
				updatedAt: now,
			}));
			// D1 binds at most 100 values per statement: ten rows stay under it.
			const chunks: (typeof rows)[] = [];
			for (let start = 0; start < rows.length; start += 10) {
				chunks.push(rows.slice(start, start + 10));
			}
			const [first, ...rest] = chunks.map((chunk) =>
				db.insert(item).values(chunk),
			);
			if (!first) throw new ORPCError("BAD_REQUEST");
			await db.batch([
				first,
				...rest,
				...(input.total
					? [
							logEvent(db, {
								actorType: "member",
								actorId: userId,
								action: "imported",
								vaultId: input.vaultId,
								detail: String(input.total),
							}),
						]
					: []),
			]);
			return { ids: rows.map((row) => row.id) };
		}),

	/** Saves new ciphertext. Moving to another vault re-wraps the item key on the device. */
	update: memberProcedure
		.input(
			z.object({
				id: z.string(),
				revision: z.number().int(),
				data,
				vaultId: z.string().optional(),
				wrappedKey: wrapped.optional(),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const current = await requireItemAccess(db, userId, input.id);
			if (current.revision !== input.revision) {
				throw new ORPCError("CONFLICT", {
					message:
						"Someone changed this item while you were editing. Reload to see it.",
				});
			}
			const moving = input.vaultId && input.vaultId !== current.vaultId;
			if (moving) {
				if (!input.wrappedKey)
					throw new ORPCError("BAD_REQUEST", { message: "Missing key" });
				await requireVaultAccess(db, userId, input.vaultId as string);
			}
			await db.batch([
				db
					.update(item)
					.set({
						data: input.data,
						revision: current.revision + 1,
						updatedBy: userId,
						updatedAt: new Date(),
						...(moving
							? { vaultId: input.vaultId, wrappedKey: input.wrappedKey }
							: {}),
					})
					.where(eq(item.id, input.id)),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "updated",
					itemId: input.id,
					vaultId: moving ? input.vaultId : current.vaultId,
				}),
			]);
			return { revision: current.revision + 1 };
		}),

	remove: memberProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const current = await requireItemAccess(db, userId, input.id);
			await db.batch([
				db.delete(item).where(eq(item.id, input.id)),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "deleted",
					itemId: input.id,
					vaultId: current.vaultId,
				}),
			]);
		}),

	favorite: memberProcedure
		.input(z.object({ id: z.string(), value: z.boolean() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireItemAccess(db, userId, input.id);
			if (input.value) {
				await db
					.insert(favorite)
					.values({ userId, itemId: input.id })
					.onConflictDoNothing();
			} else {
				await db
					.delete(favorite)
					.where(
						and(eq(favorite.userId, userId), eq(favorite.itemId, input.id)),
					);
			}
		}),

	/** The device reports reveals and copies, so the audit log shows who looked. */
	log: memberProcedure
		.input(
			z.object({
				id: z.string(),
				action: z.enum(["revealed", "copied"]),
				field: z.string().max(40),
			}),
		)
		.handler(async ({ context, input }) => {
			const current = await requireItemAccess(
				context.db,
				context.userId,
				input.id,
			);
			await logEvent(context.db, {
				actorType: "member",
				actorId: context.userId,
				action: input.action,
				itemId: input.id,
				vaultId: current.vaultId,
				detail: input.field,
			});
		}),
};
