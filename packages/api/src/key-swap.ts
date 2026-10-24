import type { Database } from "@vauly/db";
import { account, session } from "@vauly/db/schema/auth";
import { member } from "@vauly/db/schema/vault";
import { and, eq, ne, sql } from "drizzle-orm";

// Swapping a person's auth hash and sealed keys, for a new master password or a move to
// Argon2id. Both change only if the keys are still the ones the request started from,
// checked in the same batch that changes them: of two requests at once (two devices
// moving the account, or a move and a password change), one wins and the other changes
// nothing. account.ts runs these statements in one batch.

export type NewKeys = {
	kdfSalt: string;
	kdf: "pbkdf2" | "argon2id";
	kdfIterations: number;
	kdfPasses?: number | null;
	kdfMemory?: number | null;
	encryptedPrivateKey: string;
};

/** True while the person's keys still have this salt (and KDF, when given). */
const keysAre = (
	userId: string,
	kdfSalt: string,
	kdf?: "pbkdf2" | "argon2id",
) =>
	sql`exists (select 1 from member as current where current.user_id = ${userId} and current.kdf_salt = ${kdfSalt}${kdf ? sql` and current.kdf = ${kdf}` : sql``})`;

/**
 * The auth hash, then the keys, each changed only if the keys are still `from`. The keys'
 * update returns a row only when it happened. The auth hash goes first, while the keys
 * it checks are still the old ones.
 */
export function swapKeys(
	db: Database,
	swap: {
		userId: string;
		accountId: string;
		from: { kdfSalt: string; kdf?: "pbkdf2" | "argon2id" };
		passwordHash: string;
		keys: NewKeys;
	},
) {
	const { userId, from, keys } = swap;
	return [
		db
			.update(account)
			.set({ password: swap.passwordHash, updatedAt: new Date() })
			.where(
				and(
					eq(account.id, swap.accountId),
					keysAre(userId, from.kdfSalt, from.kdf),
				),
			),
		db
			.update(member)
			.set({
				kdfSalt: keys.kdfSalt,
				kdf: keys.kdf,
				kdfIterations: keys.kdfIterations,
				kdfPasses: keys.kdfPasses ?? null,
				kdfMemory: keys.kdfMemory ?? null,
				encryptedPrivateKey: keys.encryptedPrivateKey,
			})
			.where(
				and(
					eq(member.userId, userId),
					eq(member.kdfSalt, from.kdfSalt),
					from.kdf ? eq(member.kdf, from.kdf) : undefined,
				),
			)
			.returning({ userId: member.userId }),
	] as const;
}

/**
 * Signs out the person's other sessions, but only once their keys have this new salt:
 * the salt is the swapping request's own, so a swap that lost signs nobody out.
 */
export function signOutOthersAfter(
	db: Database,
	{
		userId,
		sessionId,
		kdfSalt,
	}: { userId: string; sessionId: string; kdfSalt: string },
) {
	return db
		.delete(session)
		.where(
			and(
				eq(session.userId, userId),
				ne(session.id, sessionId),
				keysAre(userId, kdfSalt),
			),
		);
}
