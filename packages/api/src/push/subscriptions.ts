import type { Database } from "@vauly/db";
import { session } from "@vauly/db/schema/auth";
import { pushSubscription } from "@vauly/db/schema/vault";
import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { newId } from "../lib";
import { pushServiceAllowed } from "./notify";
import { type PushKeys, validKeys } from "./web-push";

// The devices that get a person's notifications: one per session, at most DEVICE_LIMIT.

/** Devices one person can get notifications on at once. */
export const DEVICE_LIMIT = 10;

/** An endpoint as the server keeps it, so one address can't pass for two; null if it isn't one. */
export function normalEndpoint(endpoint: string) {
	try {
		return new URL(endpoint).href;
	} catch {
		return null;
	}
}

export type SaveResult =
	| "saved"
	| "not-a-push-service"
	| "not-a-subscription"
	| "someone-else"
	| "too-many";

/**
 * Notifications for this session go to `endpoint`, replacing where they went before. An
 * endpoint is one browser's: it moves from the person's older session to this one, but
 * never from someone else's.
 */
export async function saveSubscription(
	db: Database,
	{
		userId,
		sessionId,
		endpoint: given,
		keys,
	}: { userId: string; sessionId: string; endpoint: string; keys: PushKeys },
	{ localhost = false } = {},
): Promise<SaveResult> {
	const endpoint = normalEndpoint(given);
	if (!endpoint || !pushServiceAllowed(endpoint, { localhost }))
		return "not-a-push-service";
	if (!(await validKeys(keys))) return "not-a-subscription";

	const [holder] = await db
		.select({ userId: pushSubscription.userId })
		.from(pushSubscription)
		.where(eq(pushSubscription.endpoint, endpoint));
	if (holder && holder.userId !== userId) return "someone-else";

	// Devices of sessions that ran out don't count, and go.
	const expired = db
		.select({ id: session.id })
		.from(session)
		.where(and(eq(session.userId, userId), lte(session.expiresAt, new Date())));
	await db
		.delete(pushSubscription)
		.where(
			and(
				eq(pushSubscription.userId, userId),
				inArray(pushSubscription.sessionId, expired),
			),
		);
	// The person's own: from this session, or an older one on the same browser.
	if (holder)
		await db
			.delete(pushSubscription)
			.where(eq(pushSubscription.endpoint, endpoint));
	// Counting and saving in one statement, so subscribes at the same moment can't pass
	// the limit together. A session's device is replaced in place.
	const saved = await db.all<{ id: string }>(sql`
		INSERT INTO ${pushSubscription} (id, user_id, session_id, endpoint, p256dh, auth)
		SELECT ${newId("psb")}, ${userId}, ${sessionId}, ${endpoint}, ${keys.p256dh}, ${keys.auth}
		WHERE (
			SELECT count(*) FROM ${pushSubscription}
			WHERE user_id = ${userId} AND session_id <> ${sessionId}
		) < ${DEVICE_LIMIT}
		ON CONFLICT (session_id) DO UPDATE SET
			endpoint = excluded.endpoint,
			p256dh = excluded.p256dh,
			auth = excluded.auth,
			failures = 0
		RETURNING id
	`);
	return saved.length > 0 ? "saved" : "too-many";
}
