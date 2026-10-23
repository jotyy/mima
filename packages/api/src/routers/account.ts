import { ORPCError } from "@orpc/server";
import {
	hashRecoveryCode,
	matchCode,
	newRecoveryCodes,
	newSetupKey,
} from "@vauly/auth/two-step";
import { account, session, user } from "@vauly/db/schema/auth";
import {
	invite,
	member,
	setting,
	vault,
	vaultAccess,
} from "@vauly/db/schema/vault";
import { and, count, eq, gt, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Context } from "../context";
import { adminProcedure, memberProcedure, publicProcedure } from "../index";
import { hashToken, logEvent, newId } from "../lib";
import { deleteWorkspace, removeFromWorkspace } from "../workspace";

/** What new accounts derive with (ARGON2ID in @vauly/crypto), and what decoys answer. */
const NEW_ACCOUNT_KDF = {
	kdf: "argon2id",
	kdfIterations: 3,
	kdfMemory: 64 * 1024,
} as const;

const keyFields = z.object({
	kdfSalt: z.string().min(16).max(64),
	// Apps from before Argon2id don't send it.
	kdf: z.enum(["pbkdf2", "argon2id"]).default("pbkdf2"),
	/** PBKDF2's rounds, or Argon2's passes. */
	kdfIterations: z.number().int().min(1).max(10_000_000),
	/** Argon2's memory in KiB. */
	kdfMemory: z
		.number()
		.int()
		.min(19 * 1024)
		.max(1024 * 1024)
		.nullish(),
	publicKey: z.string().min(40).max(400),
	encryptedPrivateKey: z.string().min(40).max(1_000),
});

/** Settings that make sense for their KDF; the apps hold servers to stricter limits. */
const validKdf = (keys: {
	kdf: "pbkdf2" | "argon2id";
	kdfIterations: number;
	kdfMemory?: number | null;
}) =>
	keys.kdf === "argon2id"
		? keys.kdfMemory != null && keys.kdfIterations <= 10
		: keys.kdfMemory == null && keys.kdfIterations >= 1_000;
const kdfMessage = {
	message: "Those key derivation settings don't fit together",
};

const accountKeys = keyFields.refine(validKdf, kdfMessage);
const newPasswordKeys = keyFields
	.omit({ publicKey: true })
	.refine(validKdf, kdfMessage);

async function hmac(secret: string, message: string) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)),
	);
}

/** Same salt every time for the same unknown email, so probing reveals nothing. */
async function decoySalt(secret: string, email: string) {
	const mac = await hmac(secret, `salt:${email}`);
	return btoa(String.fromCharCode(...mac.slice(0, 16)));
}

/** How long a device unlocks with a passkey before it needs the master password again. */
const DEVICE_UNLOCK_DAYS = 14;

/**
 * The person's password login, refused unless `authKey` (derived from their master
 * password on the device) matches it. Guards the steps that can't be undone.
 */
async function checkAuthKey(
	context: Pick<Context, "db" | "auth"> & { userId: string },
	authKey: string,
) {
	const auth = await context.auth.$context;
	const [credential] = await context.db
		.select({ id: account.id, password: account.password })
		.from(account)
		.where(
			and(
				eq(account.userId, context.userId),
				eq(account.providerId, "credential"),
			),
		);
	const valid =
		credential?.password &&
		(await auth.password.verify({
			hash: credential.password,
			password: authKey,
		}));
	if (!credential || !valid) {
		throw new ORPCError("FORBIDDEN", {
			message: "The current master password is wrong",
		});
	}
	return credential;
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
			workspaceName: name?.value ?? "vauly",
			needsSetupCode: (row?.n ?? 0) === 0 && Boolean(context.setupCode),
		};
	}),

	prelogin: publicProcedure
		.input(z.object({ email: z.email() }))
		.handler(async ({ context, input }) => {
			const email = input.email.toLowerCase();
			const [row] = await context.db
				.select({
					kdfSalt: member.kdfSalt,
					kdf: member.kdf,
					kdfIterations: member.kdfIterations,
					kdfMemory: member.kdfMemory,
				})
				.from(member)
				.innerJoin(user, eq(user.id, member.userId))
				.where(eq(user.email, email));
			return (
				row ?? {
					kdfSalt: await decoySalt(context.secret, email),
					...NEW_ACCOUNT_KDF,
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
				setupCode: z.string().max(200).optional(),
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
			if (
				bootstrap &&
				context.setupCode &&
				input.setupCode !== context.setupCode
			) {
				throw new ORPCError("FORBIDDEN", {
					message:
						"Open the setup link from the deploy to create the workspace",
				});
			}

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
										value: input.workspaceName ?? "vauly",
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

	/**
	 * The server's half of the key that seals a device's passkey copy of the private key:
	 * an HMAC of this session and of when the copy was made. Once the session ends, or the
	 * copy is older than DEVICE_UNLOCK_DAYS, nobody can get it, so the copy no longer
	 * opens. Without `issuedAt`, a new copy starts now.
	 */
	devicePepper: memberProcedure
		.input(z.object({ issuedAt: z.number().int().positive().optional() }))
		.handler(async ({ context, input }) => {
			const now = Date.now();
			const issuedAt = input.issuedAt ?? now;
			const age = now - issuedAt;
			if (age < -60_000 || age > DEVICE_UNLOCK_DAYS * 24 * 60 * 60_000) {
				throw new ORPCError("FORBIDDEN", {
					message: `Unlocking with a passkey lasts ${DEVICE_UNLOCK_DAYS} days. Use your master password.`,
				});
			}
			const pepper = await hmac(
				context.secret,
				`device:${context.session.session.id}:${issuedAt}`,
			);
			return { issuedAt, pepper: btoa(String.fromCharCode(...pepper)) };
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
			twoStep: me.totpSecret !== null,
			recoveryCodesLeft: me.recoveryCodes?.length ?? 0,
			keys: {
				kdfSalt: me.kdfSalt,
				kdf: me.kdf,
				kdfIterations: me.kdfIterations,
				kdfMemory: me.kdfMemory,
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
				keys: newPasswordKeys,
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const auth = await context.auth.$context;
			const credential = await checkAuthKey(context, input.currentAuthKey);
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
						kdf: input.keys.kdf,
						kdfIterations: input.keys.kdfIterations,
						kdfMemory: input.keys.kdfMemory ?? null,
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

	/**
	 * Moves the person's keys to Argon2id without changing their master password: the auth
	 * key and the sealed private key swap together, as with a new password, but their other
	 * sessions stay signed in, since the password is the same. The web app calls it after an
	 * unlock with a master password that still goes through PBKDF2.
	 */
	upgradeKdf: memberProcedure
		.input(
			z.object({
				currentAuthKey: z.string().length(64),
				authKey: z.string().length(64),
				keys: newPasswordKeys.refine((keys) => keys.kdf === "argon2id", {
					message: "Only a move to Argon2id",
				}),
			}),
		)
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			const auth = await context.auth.$context;
			const credential = await checkAuthKey(context, input.currentAuthKey);
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
						kdf: input.keys.kdf,
						kdfIterations: input.keys.kdfIterations,
						kdfMemory: input.keys.kdfMemory ?? null,
						encryptedPrivateKey: input.keys.encryptedPrivateKey,
					})
					.where(eq(member.userId, userId)),
				logEvent(db, {
					actorType: "member",
					actorId: userId,
					action: "updated",
					detail: "key derivation",
				}),
			]);
			return { ok: true };
		}),

	/**
	 * Deletes the person's own account, the way an admin removing them would. The owner
	 * hands the workspace over first, unless they're the last one in it: then the whole
	 * workspace goes, and the next visit starts a new one.
	 */
	deleteAccount: memberProcedure
		.input(z.object({ authKey: z.string().length(64) }))
		.handler(async ({ context, input }) => {
			const { db, userId } = context;
			await checkAuthKey(context, input.authKey);
			if (context.member.role !== "owner") {
				await removeFromWorkspace(db, { by: userId, userId });
				return { workspaceDeleted: false };
			}
			const [others] = await db
				.select({ n: count() })
				.from(member)
				.where(ne(member.userId, userId));
			if ((others?.n ?? 0) > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"You own this workspace. Make someone else the owner on the Members page first.",
				});
			}
			await deleteWorkspace(db);
			return { workspaceDeleted: true };
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

	/**
	 * Two-step login, step one: a new setup key for the authenticator app. It only takes
	 * effect once a code from it is confirmed.
	 */
	beginTwoStep: memberProcedure.handler(async ({ context }) => {
		const { db, member: me, session } = context;
		if (me.totpSecret) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Two-step login is on already",
			});
		}
		const secret = newSetupKey();
		await db
			.update(member)
			.set({ totpPending: secret })
			.where(eq(member.userId, me.userId));
		const [workspace] = await db
			.select({ value: setting.value })
			.from(setting)
			.where(eq(setting.key, "workspace_name"));
		const issuer = `vauly ${workspace?.value ?? ""}`.trim();
		const label = encodeURIComponent(`${issuer}:${session.user.email}`);
		return {
			secret,
			uri: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`,
		};
	}),

	/** Step two: a code from the new setup key turns it on, and returns recovery codes once. */
	confirmTwoStep: memberProcedure
		.input(z.object({ code: z.string().trim().min(6).max(12) }))
		.handler(async ({ context, input }) => {
			const { db, member: me } = context;
			if (!me.totpPending) {
				throw new ORPCError("BAD_REQUEST", { message: "Start again" });
			}
			const step = await matchCode(me.totpPending, input.code);
			if (step === null) {
				throw new ORPCError("BAD_REQUEST", {
					message: "That code didn't work. Check the time on your phone.",
				});
			}
			const recoveryCodes = newRecoveryCodes();
			await db.batch([
				db
					.update(member)
					.set({
						totpSecret: me.totpPending,
						totpPending: null,
						totpStep: step,
						recoveryCodes: await Promise.all(
							recoveryCodes.map(hashRecoveryCode),
						),
					})
					.where(eq(member.userId, me.userId)),
				logEvent(db, {
					actorType: "member",
					actorId: me.userId,
					action: "updated",
					detail: "two-step login on",
				}),
			]);
			return { recoveryCodes };
		}),

	/** Turning it off takes a current code, or a recovery code. */
	disableTwoStep: memberProcedure
		.input(z.object({ code: z.string().trim().min(6).max(12) }))
		.handler(async ({ context, input }) => {
			const { db, member: me } = context;
			if (!me.totpSecret) return { ok: true };
			const matched =
				(await matchCode(me.totpSecret, input.code, me.totpStep ?? -1)) !==
					null ||
				(me.recoveryCodes ?? []).includes(await hashRecoveryCode(input.code));
			if (!matched) {
				throw new ORPCError("BAD_REQUEST", {
					message: "That code didn't work",
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
					.where(eq(member.userId, me.userId)),
				logEvent(db, {
					actorType: "member",
					actorId: me.userId,
					action: "updated",
					detail: "two-step login off",
				}),
			]);
			return { ok: true };
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
