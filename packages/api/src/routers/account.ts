import { user } from "@mima/db/schema/auth";
import { invite, member, vault, vaultAccess } from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure, publicProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";

const DEFAULT_ITERATIONS = 600_000;

const accountKeys = z.object({
	kdfSalt: z.string().min(16).max(64),
	kdfIterations: z.number().int().min(1_000).max(10_000_000),
	publicKey: z.string().min(40).max(400),
	encryptedPrivateKey: z.string().min(40).max(1_000),
});

/** Same salt every time for the same unknown email, so probing reveals nothing. */
async function decoySalt(secret: string, email: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = new Uint8Array(
		await crypto.subtle.sign(
			"HMAC",
			key,
			new TextEncoder().encode(`salt:${email}`),
		),
	);
	return btoa(String.fromCharCode(...mac.slice(0, 16)));
}

export const accountRouter = {
	/** Whether the workspace has an owner yet; the first person to register becomes it. */
	status: publicProcedure.handler(async ({ context }) => {
		const [row] = await context.db.select({ n: count() }).from(member);
		return { hasOwner: (row?.n ?? 0) > 0 };
	}),

	prelogin: publicProcedure
		.input(z.object({ email: z.email() }))
		.handler(async ({ context, input }) => {
			const email = input.email.toLowerCase();
			const [row] = await context.db
				.select({
					kdfSalt: member.kdfSalt,
					kdfIterations: member.kdfIterations,
				})
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(user.email, email));
			return (
				row ?? {
					kdfSalt: await decoySalt(context.secret, email),
					kdfIterations: DEFAULT_ITERATIONS,
				}
			);
		}),

	/** Looks up an invite before the person picks a master password. */
	invite: publicProcedure
		.input(z.object({ token: z.string().min(10).max(200) }))
		.handler(async ({ context, input }) => {
			const [row] = await context.db
				.select({
					email: invite.email,
					role: invite.role,
					invitedBy: user.name,
				})
				.from(invite)
				.innerJoin(user, eq(user.id, invite.invitedBy))
				.where(
					and(
						eq(invite.tokenHash, await hashToken(input.token)),
						isNull(invite.acceptedAt),
						gt(invite.expiresAt, new Date()),
					),
				);
			if (!row)
				throw new ORPCError("NOT_FOUND", {
					message: "This invite is no longer valid",
				});
			return row;
		}),

	register: publicProcedure
		.input(
			z.object({
				email: z.email(),
				name: z.string().trim().min(1).max(80),
				authKey: z.string().regex(/^[0-9a-f]{64}$/),
				keys: accountKeys,
				inviteToken: z.string().max(200).optional(),
				personalVault: z.object({
					encryptedMeta: z.string().min(20).max(4_000),
					wrappedKey: z.string().min(40).max(1_000),
				}),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db } = context;
			const email = input.email.toLowerCase();
			const [owners] = await db.select({ n: count() }).from(member);
			const bootstrap = (owners?.n ?? 0) === 0;

			let role: "owner" | "admin" | "member" = "owner";
			let inviteId: string | null = null;
			if (!bootstrap) {
				if (!input.inviteToken) {
					throw new ORPCError("FORBIDDEN", {
						message: "You need an invite to join",
					});
				}
				const [row] = await db
					.select()
					.from(invite)
					.where(
						and(
							eq(invite.tokenHash, await hashToken(input.inviteToken)),
							isNull(invite.acceptedAt),
							gt(invite.expiresAt, new Date()),
						),
					);
				if (!row || row.email !== email) {
					throw new ORPCError("FORBIDDEN", {
						message: "This invite is no longer valid",
					});
				}
				role = row.role;
				inviteId = row.id;
			}

			const created = await context.auth.api.signUpEmail({
				body: { email, password: input.authKey, name: input.name },
			});
			const userId = created.user.id;
			const vaultId = newId("vlt");
			try {
				await db.batch([
					db.insert(member).values({ userId, role, ...input.keys }),
					db.insert(vault).values({
						id: vaultId,
						encryptedMeta: input.personalVault.encryptedMeta,
						personalFor: userId,
						createdBy: userId,
					}),
					db.insert(vaultAccess).values({
						vaultId,
						userId,
						wrappedKey: input.personalVault.wrappedKey,
						grantedBy: userId,
					}),
					...(inviteId
						? [
								db
									.update(invite)
									.set({ acceptedAt: new Date() })
									.where(eq(invite.id, inviteId)),
							]
						: []),
					logEvent(db, {
						actorType: "member",
						actorId: userId,
						action: "joined",
						detail: role,
					}),
				]);
			} catch (error) {
				await db.delete(user).where(eq(user.id, userId));
				throw error;
			}
			return { userId, role };
		}),

	me: memberProcedure.handler(async ({ context }) => {
		const { member: me, session } = context;
		await context.db
			.update(member)
			.set({ lastSeenAt: new Date() })
			.where(eq(member.userId, me.userId));
		return {
			id: me.userId,
			name: session.user.name,
			email: session.user.email,
			role: me.role,
			keys: {
				kdfSalt: me.kdfSalt,
				kdfIterations: me.kdfIterations,
				publicKey: me.publicKey,
				encryptedPrivateKey: me.encryptedPrivateKey,
			},
		};
	}),
};
