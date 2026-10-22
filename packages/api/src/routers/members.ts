import { user } from "@mima/db/schema/auth";
import { invite, member, vault, vaultAccess } from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, memberProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";

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
			await db.batch([
				db.delete(vault).where(eq(vault.personalFor, input.userId)),
				db.delete(user).where(eq(user.id, input.userId)),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "revoked",
					subjectId: input.userId,
					detail: "removed from workspace",
				}),
			]);
		}),
};
