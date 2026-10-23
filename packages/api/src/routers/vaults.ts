import { ORPCError } from "@orpc/server";
import { user } from "@vauly/db/schema/auth";
import { item, member, vault, vaultAccess } from "@vauly/db/schema/vault";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { logEvent, myVaultIds, newId, requireVaultAccess } from "../lib";

const sealed = z.string().min(20).max(4_000);
const wrapped = z.string().min(40).max(1_000);

export const vaultsRouter = {
	list: memberProcedure.handler(async ({ context }) => {
		const { db, userId } = context;
		const ids = await myVaultIds(db, userId);
		if (ids.length === 0) return [];
		const [vaults, access, counts] = await Promise.all([
			db.select().from(vault).where(inArray(vault.id, ids)),
			db
				.select({
					vaultId: vaultAccess.vaultId,
					userId: vaultAccess.userId,
					wrappedKey: vaultAccess.wrappedKey,
					name: user.name,
					email: user.email,
				})
				.from(vaultAccess)
				.innerJoin(user, eq(user.id, vaultAccess.userId))
				.where(inArray(vaultAccess.vaultId, ids)),
			db
				.select({ vaultId: item.vaultId, n: count() })
				.from(item)
				.where(and(inArray(item.vaultId, ids), isNull(item.deletedAt)))
				.groupBy(item.vaultId),
		]);
		return vaults.map((v) => ({
			id: v.id,
			encryptedMeta: v.encryptedMeta,
			personal: v.personalFor !== null,
			createdAt: v.createdAt,
			wrappedKey:
				access.find((a) => a.vaultId === v.id && a.userId === userId)
					?.wrappedKey ?? "",
			members: access
				.filter((a) => a.vaultId === v.id)
				.map((a) => ({ userId: a.userId, name: a.name, email: a.email })),
			itemCount: counts.find((c) => c.vaultId === v.id)?.n ?? 0,
		}));
	}),

	create: memberProcedure
		.input(z.object({ encryptedMeta: sealed, wrappedKey: wrapped }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const id = newId("vlt");
			await db.batch([
				db.insert(vault).values({
					id,
					encryptedMeta: input.encryptedMeta,
					createdBy: userId,
				}),
				db.insert(vaultAccess).values({
					vaultId: id,
					userId,
					wrappedKey: input.wrappedKey,
					grantedBy: userId,
				}),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "created",
					vaultId: id,
				}),
			]);
			return { id };
		}),

	update: memberProcedure
		.input(z.object({ id: z.string(), encryptedMeta: sealed }))
		.handler(async ({ context, input }) => {
			await requireVaultAccess(context.db, context.userId, input.id);
			await context.db
				.update(vault)
				.set({ encryptedMeta: input.encryptedMeta })
				.where(eq(vault.id, input.id));
		}),

	/** Gives a member the vault key, wrapped to their public key on this device. */
	share: memberProcedure
		.input(
			z.object({
				vaultId: z.string(),
				userId: z.string(),
				wrappedKey: wrapped,
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId);
			const [target] = await db
				.select()
				.from(vault)
				.where(eq(vault.id, input.vaultId));
			if (target?.personalFor) {
				throw new ORPCError("BAD_REQUEST", {
					message: "A private vault can't be shared",
				});
			}
			const [recipient] = await db
				.select({ name: user.name })
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(member.userId, input.userId));
			if (!recipient)
				throw new ORPCError("NOT_FOUND", { message: "Member not found" });
			await db.batch([
				db
					.insert(vaultAccess)
					.values({
						vaultId: input.vaultId,
						userId: input.userId,
						wrappedKey: input.wrappedKey,
						grantedBy: userId,
					})
					.onConflictDoUpdate({
						target: [vaultAccess.vaultId, vaultAccess.userId],
						set: { wrappedKey: input.wrappedKey, grantedBy: userId },
					}),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "shared",
					vaultId: input.vaultId,
					subjectId: input.userId,
					detail: recipient.name,
				}),
			]);
		}),

	unshare: memberProcedure
		.input(z.object({ vaultId: z.string(), userId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId);
			const [target] = await db
				.select()
				.from(vault)
				.where(eq(vault.id, input.vaultId));
			if (target?.personalFor) {
				throw new ORPCError("BAD_REQUEST", {
					message: "You can't leave your private vault",
				});
			}
			const [person] = await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.userId));
			await db
				.delete(vaultAccess)
				.where(
					and(
						eq(vaultAccess.vaultId, input.vaultId),
						eq(vaultAccess.userId, input.userId),
					),
				);
			await logEvent(db, {
				actorType: "member",
				actorId: userId,
				action: "revoked",
				vaultId: input.vaultId,
				subjectId: input.userId,
				// Kept by name: the person may later leave the workspace altogether.
				detail: person?.name ?? null,
			});
		}),

	remove: memberProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.id);
			const [target] = await db
				.select()
				.from(vault)
				.where(eq(vault.id, input.id));
			if (target?.personalFor) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Your private vault can't be deleted",
				});
			}
			await db.delete(vault).where(eq(vault.id, input.id));
			await logEvent(db, {
				actorType: "member",
				actorId: userId,
				action: "deleted",
				vaultId: input.id,
			});
		}),
};
