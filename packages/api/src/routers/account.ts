import { account, session, user } from "@mima/db/schema/auth";
import {
	invite,
	member,
	setting,
	vault,
	vaultAccess,
} from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, count, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { adminProcedure, memberProcedure, publicProcedure } from "../index";
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
		const [[row], [name]] = await Promise.all([
			context.db.select({ n: count() }).from(member),
			context.db
				.select({ value: setting.value })
				.from(setting)
				.where(eq(setting.key, "workspace_name")),
		]);
		return {
			hasOwner: (row?.n ?? 0) > 0,
			workspaceName: name?.value ?? "mima",
		};
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
				/** Only used by the first person, who creates the workspace. */
				workspaceName: z.string().trim().min(1).max(40).optional(),
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
					...(bootstrap
						? [
								db
									.insert(setting)
									.values({
										key: "workspace_name",
										value: input.workspaceName ?? "mima",
									})
									.onConflictDoNothing(),
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

	updateProfile: memberProcedure
		.input(z.object({ name: z.string().trim().min(1).max(80) }))
		.handler(async ({ context, input }) => {
			await context.db
				.update(user)
				.set({ name: input.name, updatedAt: new Date() })
				.where(eq(user.id, context.userId));
			return { name: input.name };
		}),

	/**
	 * Swaps the auth key and the sealed private key together, so the account can never be
	 * left with one but not the other. Other sessions are signed out.
	 */
	changePassword: memberProcedure
		.input(
			z.object({
				currentAuthKey: z.string().length(64),
				authKey: z.string().length(64),
				keys: accountKeys.omit({ publicKey: true }),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const auth = await context.auth.$context;
			const [credential] = await db
				.select({ id: account.id, password: account.password })
				.from(account)
				.where(
					and(eq(account.userId, userId), eq(account.providerId, "credential")),
				);
			const valid =
				credential?.password &&
				(await auth.password.verify({
					hash: credential.password,
					password: input.currentAuthKey,
				}));
			if (!credential || !valid) {
				throw new ORPCError("FORBIDDEN", {
					message: "The current master password is wrong",
				});
			}
			await db.batch([
				db
					.update(account)
					.set({
						password: await auth.password.hash(input.authKey),
						updatedAt: new Date(),
					})
					.where(eq(account.id, credential.id)),
				db
					.update(member)
					.set({
						kdfSalt: input.keys.kdfSalt,
						kdfIterations: input.keys.kdfIterations,
						encryptedPrivateKey: input.keys.encryptedPrivateKey,
					})
					.where(eq(member.userId, userId)),
				db
					.delete(session)
					.where(
						and(
							eq(session.userId, userId),
							ne(session.id, context.session.session.id),
						),
					),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "updated",
					detail: "master password",
				}),
			]);
			return { ok: true };
		}),

	renameWorkspace: adminProcedure
		.input(z.object({ name: z.string().trim().min(1).max(40) }))
		.handler(async ({ context, input }) => {
			await context.db
				.insert(setting)
				.values({ key: "workspace_name", value: input.name })
				.onConflictDoUpdate({
					target: setting.key,
					set: { value: input.name },
				});
			return { name: input.name };
		}),

	/** Records that someone downloaded a decrypted backup. Only the count is logged. */
	exported: memberProcedure
		.input(z.object({ count: z.number().int().min(0) }))
		.handler(async ({ context, input }) => {
			await logEvent(context.db, {
				actorType: "member",
				actorId: context.userId,
				action: "exported",
				detail: String(input.count),
			});
			return { ok: true };
		}),
};
