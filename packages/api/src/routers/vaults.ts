import { ORPCError } from "@orpc/server";
import type { Database } from "@vauly/db";
import { user } from "@vauly/db/schema/auth";
import {
	agent,
	agentGrant,
	item,
	member,
	type VaultRole,
	vault,
	vaultAccess,
} from "@vauly/db/schema/vault";
import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { logEvent, myVaultIds, newId, requireVaultAccess } from "../lib";

const sealed = z.string().min(20).max(4_000);
const wrapped = z.string().min(40).max(1_000);
const role = z.enum(["view", "edit", "manage"]);

/**
 * True for anyone but a vault's last manager. Every change that could take a manager away
 * carries it in its own UPDATE or DELETE, so two at once can't both pass.
 */
const mayStepDown = (vaultId: string, userId: string) =>
	or(
		ne(vaultAccess.role, "manage"),
		sql`exists (select 1 from vault_access as other where other.vault_id = ${vaultId} and other.role = 'manage' and other.user_id <> ${userId})`,
	);

const lastManager = () =>
	new ORPCError("BAD_REQUEST", {
		message: "Make someone else a manager of this vault first",
	});

/** Sets someone's role in one statement. False when it would leave the vault no manager. */
async function changeRole(
	db: Database,
	vaultId: string,
	userId: string,
	role: VaultRole,
) {
	const changed = await db
		.update(vaultAccess)
		.set({ role })
		.where(
			and(
				eq(vaultAccess.vaultId, vaultId),
				eq(vaultAccess.userId, userId),
				role === "manage" ? undefined : mayStepDown(vaultId, userId),
			),
		)
		.returning({ userId: vaultAccess.userId });
	return changed.length > 0;
}

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
					role: vaultAccess.role,
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
		return vaults.map((v) => {
			const mine = access.find(
				(a) => a.vaultId === v.id && a.userId === userId,
			);
			return {
				id: v.id,
				encryptedMeta: v.encryptedMeta,
				personal: v.personalFor !== null,
				createdAt: v.createdAt,
				wrappedKey: mine?.wrappedKey ?? "",
				role: mine?.role ?? "view",
				members: access
					.filter((a) => a.vaultId === v.id)
					.map((a) => ({
						userId: a.userId,
						name: a.name,
						email: a.email,
						role: a.role,
					})),
				itemCount: counts.find((c) => c.vaultId === v.id)?.n ?? 0,
			};
		});
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
			await requireVaultAccess(context.db, context.userId, input.id, "manage");
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
				role: role.default("edit"),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId, "manage");
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
			const [existing] = await db
				.select({ role: vaultAccess.role })
				.from(vaultAccess)
				.where(
					and(
						eq(vaultAccess.vaultId, input.vaultId),
						eq(vaultAccess.userId, input.userId),
					),
				);
			if (existing) {
				// Already in: a fresh key, and the role asked for unless that leaves no manager.
				const changing = existing.role !== input.role;
				if (
					changing &&
					!(await changeRole(db, input.vaultId, input.userId, input.role))
				) {
					throw lastManager();
				}
				await db.batch([
					db
						.update(vaultAccess)
						.set({ wrappedKey: input.wrappedKey, grantedBy: userId })
						.where(
							and(
								eq(vaultAccess.vaultId, input.vaultId),
								eq(vaultAccess.userId, input.userId),
							),
						),
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: changing ? "changed" : "shared",
						vaultId: input.vaultId,
						subjectId: input.userId,
						detail: changing ? input.role : recipient.name,
					}),
				]);
				return;
			}
			await db.batch([
				db
					.insert(vaultAccess)
					.values({
						vaultId: input.vaultId,
						userId: input.userId,
						wrappedKey: input.wrappedKey,
						role: input.role,
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

	/** Changes what someone can do in a vault. Their key stays as it is. */
	setRole: memberProcedure
		.input(z.object({ vaultId: z.string(), userId: z.string(), role }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.vaultId, "manage");
			const target = await requireVaultAccess(db, input.userId, input.vaultId);
			if (target.role === input.role) return;
			if (!(await changeRole(db, input.vaultId, input.userId, input.role))) {
				throw lastManager();
			}
			await logEvent(db, {
				actorType: "member",
				actorId: userId,
				action: "changed",
				vaultId: input.vaultId,
				subjectId: input.userId,
				detail: input.role,
			});
		}),

	unshare: memberProcedure
		.input(z.object({ vaultId: z.string(), userId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			// Anyone can leave a vault; taking someone else out needs a manager.
			await requireVaultAccess(
				db,
				userId,
				input.vaultId,
				input.userId === userId ? "view" : "manage",
			);
			const [target] = await db
				.select()
				.from(vault)
				.where(eq(vault.id, input.vaultId));
			if (target?.personalFor) {
				throw new ORPCError("BAD_REQUEST", {
					message: "You can't leave your private vault",
				});
			}
			await requireVaultAccess(db, input.userId, input.vaultId);
			const [person] = await db
				.select({ name: user.name })
				.from(user)
				.where(eq(user.id, input.userId));
			const removed = await db
				.delete(vaultAccess)
				.where(
					and(
						eq(vaultAccess.vaultId, input.vaultId),
						eq(vaultAccess.userId, input.userId),
						mayStepDown(input.vaultId, input.userId),
					),
				)
				.returning({ userId: vaultAccess.userId });
			if (removed.length === 0) {
				const [people] = await db
					.select({ n: count() })
					.from(vaultAccess)
					.where(eq(vaultAccess.vaultId, input.vaultId));
				if ((people?.n ?? 0) <= 1) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Nobody else can open this vault. Delete it instead, or add someone first.",
					});
				}
				throw lastManager();
			}
			// Their agents lose what this vault gave them, whoever approved it.
			const dropped = await db
				.delete(agentGrant)
				.where(
					and(
						inArray(
							agentGrant.agentId,
							db
								.select({ id: agent.id })
								.from(agent)
								.where(eq(agent.ownerId, input.userId)),
						),
						inArray(
							agentGrant.itemId,
							db
								.select({ id: item.id })
								.from(item)
								.where(eq(item.vaultId, input.vaultId)),
						),
					),
				)
				.returning({ agentId: agentGrant.agentId, itemId: agentGrant.itemId });
			await db.batch([
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "revoked",
					vaultId: input.vaultId,
					subjectId: input.userId,
					// Kept by name: the person may later leave the workspace altogether.
					detail: person?.name ?? null,
				}),
				...dropped.map((grant) =>
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: "revoked",
						itemId: grant.itemId,
						vaultId: input.vaultId,
						subjectId: grant.agentId,
					}),
				),
			]);
		}),

	remove: memberProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await requireVaultAccess(db, userId, input.id, "manage");
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
