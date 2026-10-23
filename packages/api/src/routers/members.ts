import { ORPCError } from "@orpc/server";
import { user } from "@vauly/db/schema/auth";
import {
	agent,
	invite,
	member,
	vault,
	vaultAccess,
} from "@vauly/db/schema/vault";
import { and, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
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
			// The person's account goes, so their name is kept in the log. One event per
			// shared vault tells the people left behind which passwords they could see.
			const [person, shared, owned] = await Promise.all([
				db
					.select({ name: user.name })
					.from(user)
					.where(eq(user.id, input.userId))
					.then((rows) => rows[0]),
				db
					.select({ vaultId: vaultAccess.vaultId, role: vaultAccess.role })
					.from(vaultAccess)
					.innerJoin(vault, eq(vault.id, vaultAccess.vaultId))
					.where(
						and(
							eq(vaultAccess.userId, input.userId),
							isNull(vault.personalFor),
						),
					),
				db
					.select({ name: agent.name })
					.from(agent)
					.where(eq(agent.ownerId, input.userId)),
			]);
			const name = person?.name ?? "Someone";
			const sharedIds = shared.map((row) => row.vaultId);
			// Vaults in this list that still have a manager. Not correlated with the row being
			// changed, so SQLite works it out once per statement.
			const managed = db
				.select({ vaultId: vaultAccess.vaultId })
				.from(vaultAccess)
				.where(eq(vaultAccess.role, "manage"));
			const [, , , promotedEditors, promotedEveryone, stranded] =
				await db.batch([
					db.delete(vault).where(eq(vault.personalFor, input.userId)),
					// Their agents stop with them; grants and requests go with the agents.
					db.delete(agent).where(eq(agent.ownerId, input.userId)),
					db.delete(user).where(eq(user.id, input.userId)),
					// A vault they were the last manager of is handed on: to the people who could
					// edit it, or to everyone left when nobody could. In the same transaction as
					// the removal, so two removals at once can't leave a vault without one.
					db
						.update(vaultAccess)
						.set({ role: "manage" })
						.where(
							and(
								inArray(vaultAccess.vaultId, sharedIds),
								eq(vaultAccess.role, "edit"),
								notInArray(vaultAccess.vaultId, managed),
							),
						)
						.returning({
							vaultId: vaultAccess.vaultId,
							userId: vaultAccess.userId,
						}),
					db
						.update(vaultAccess)
						.set({ role: "manage" })
						.where(
							and(
								inArray(vaultAccess.vaultId, sharedIds),
								notInArray(vaultAccess.vaultId, managed),
							),
						)
						.returning({
							vaultId: vaultAccess.vaultId,
							userId: vaultAccess.userId,
						}),
					// A shared vault nobody else could open goes, like their private vault: nobody
					// is left who could read it.
					db
						.delete(vault)
						.where(
							and(
								inArray(vault.id, sharedIds),
								notInArray(
									vault.id,
									db.select({ vaultId: vaultAccess.vaultId }).from(vaultAccess),
								),
							),
						)
						.returning({ id: vault.id }),
				]);
			const gone = new Set(stranded.map((row) => row.id));
			await db.batch([
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "revoked",
					subjectId: input.userId,
					detail: name,
				}),
				...shared
					.filter((row) => !gone.has(row.vaultId))
					.map((row) =>
						logEvent(db, {
							actorType: "member",
							actorId: userId,
							action: "revoked",
							vaultId: row.vaultId,
							subjectId: input.userId,
							detail: name,
						}),
					),
				...[...promotedEditors, ...promotedEveryone].map((next) =>
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: "changed",
						vaultId: next.vaultId,
						subjectId: next.userId,
						detail: "manage",
					}),
				),
				...[...gone].map((vaultId) =>
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: "deleted",
						vaultId,
					}),
				),
				...owned.map((row) =>
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: "deleted",
						detail: `agent ${row.name}`,
					}),
				),
			]);
		}),
};
