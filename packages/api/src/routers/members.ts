import { ORPCError } from "@orpc/server";
import { user } from "@vauly/db/schema/auth";
import { invite, member, vault, vaultAccess } from "@vauly/db/schema/vault";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, memberProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";
import { removeFromWorkspace } from "../workspace";

const INVITE_DAYS = 7;

export const membersRouter = {
	list: memberProcedure.handler(async ({ context }) => {
		const { db } = context;
		const [people, access, invites] = await Promise.all([
			db
				.select({
					userId: member.userId,
					role: member.role,
					publicKey: member.publicKey,
					lastSeenAt: member.lastSeenAt,
					createdAt: member.createdAt,
					// Whether it's on, never the setup key itself.
					twoStep: sql<boolean>`${member.totpSecret} is not null`.mapWith(
						Boolean,
					),
					name: user.name,
					email: user.email,
				})
				.from(member)
				.innerJoin(user, eq(user.id, member.userId)),
			db
				.select({ userId: vaultAccess.userId, vaultId: vaultAccess.vaultId })
				.from(vaultAccess)
				.innerJoin(vault, eq(vault.id, vaultAccess.vaultId))
				.where(isNull(vault.personalFor)),
			context.member.role === "member"
				? Promise.resolve([])
				: db
						.select({
							id: invite.id,
							email: invite.email,
							role: invite.role,
							createdAt: invite.createdAt,
							expiresAt: invite.expiresAt,
						})
						.from(invite)
						.where(
							and(isNull(invite.acceptedAt), gt(invite.expiresAt, new Date())),
						),
		]);
		return {
			members: people.map((person) => ({
				...person,
				sharedVaultIds: access
					.filter((a) => a.userId === person.userId)
					.map((a) => a.vaultId),
			})),
			invites,
		};
	}),

	invite: adminProcedure
		.input(z.object({ email: z.email(), role: z.enum(["admin", "member"]) }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const email = input.email.toLowerCase();
			const [existing] = await db
				.select()
				.from(user)
				.where(eq(user.email, email));
			if (existing)
				throw new ORPCError("CONFLICT", {
					message: `${email} is already a member`,
				});
			const token = `${newId("inv")}${crypto.randomUUID().replaceAll("-", "")}`;
			const id = newId("inv");
			await db.batch([
				db
					.delete(invite)
					.where(and(eq(invite.email, email), isNull(invite.acceptedAt))),
				db.insert(invite).values({
					id,
					email,
					role: input.role,
					tokenHash: await hashToken(token),
					invitedBy: userId,
					expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
				}),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "invited",
					detail: email,
				}),
			]);
			return { id, token };
		}),

	revokeInvite: adminProcedure
		.input(z.object({ id: z.string() }))
		.handler(async ({ context, input }) => {
			await context.db.delete(invite).where(eq(invite.id, input.id));
		}),

	setRole: adminProcedure
		.input(z.object({ userId: z.string(), role: z.enum(["admin", "member"]) }))
		.handler(async ({ context, input }) => {
			const [target] = await context.db
				.select()
				.from(member)
				.where(eq(member.userId, input.userId));
			if (!target)
				throw new ORPCError("NOT_FOUND", { message: "Member not found" });
			if (target.role === "owner") {
				throw new ORPCError("BAD_REQUEST", {
					message: "The owner's role can't change",
				});
			}
			await context.db
				.update(member)
				.set({ role: input.role })
				.where(eq(member.userId, input.userId));
		}),

	/**
	 * The owner hands the workspace to someone else and becomes an admin, say before
	 * deleting their own account. Both changes are one transaction, and the promotion only
	 * happens while the caller still owns the workspace, so there's never a second owner.
	 */
	transferOwnership: memberProcedure
		.input(z.object({ userId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			if (context.member.role !== "owner") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only the owner can hand the workspace over",
				});
			}
			if (input.userId === userId) return;
			const [target] = await db
				.select({ userId: member.userId })
				.from(member)
				.where(eq(member.userId, input.userId));
			if (!target)
				throw new ORPCError("NOT_FOUND", { message: "Member not found" });
			const [promoted] = await db.batch([
				db
					.update(member)
					.set({ role: "owner" })
					.where(
						and(
							eq(member.userId, input.userId),
							sql`exists (select 1 from member as current where current.user_id = ${userId} and current.role = 'owner')`,
						),
					)
					.returning({ userId: member.userId }),
				db
					.update(member)
					.set({ role: "admin" })
					.where(
						and(
							eq(member.userId, userId),
							eq(member.role, "owner"),
							// Only once the new owner is in place, so there's always one.
							sql`exists (select 1 from member as next where next.user_id = ${input.userId} and next.role = 'owner')`,
						),
					),
			]);
			if (promoted.length === 0) {
				throw new ORPCError("CONFLICT", {
					message: "You don't own this workspace anymore",
				});
			}
			await logEvent(db, {
				actorType: "member",
				actorId: userId,
				action: "changed",
				subjectId: input.userId,
				detail: "owner",
			});
		}),

	/** For someone who lost their phone and their recovery codes. */
	resetTwoStep: adminProcedure
		.input(z.object({ userId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const [target] = await db
				.select({ role: member.role })
				.from(member)
				.where(eq(member.userId, input.userId));
			if (!target)
				throw new ORPCError("NOT_FOUND", { message: "Member not found" });
			if (target.role === "owner" && context.member.role !== "owner") {
				throw new ORPCError("FORBIDDEN", {
					message: "Only the owner can do this for the owner",
				});
			}
			await db.batch([
				db
					.update(member)
					.set({
						totpSecret: null,
						totpPending: null,
						totpStep: null,
						recoveryCodes: null,
					})
					.where(eq(member.userId, input.userId)),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "updated",
					subjectId: input.userId,
					detail: "two-step login reset",
				}),
			]);
		}),

	remove: adminProcedure
		.input(z.object({ userId: z.string() }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const [target] = await db
				.select()
				.from(member)
				.where(eq(member.userId, input.userId));
			if (!target)
				throw new ORPCError("NOT_FOUND", { message: "Member not found" });
			if (target.role === "owner" || target.userId === userId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "You can't remove the owner or yourself",
				});
			}
			await removeFromWorkspace(db, { by: userId, userId: input.userId });
		}),
};
