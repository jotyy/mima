import type { Database } from "@vauly/db";
import { session } from "@vauly/db/schema/auth";
import { pushSubscription } from "@vauly/db/schema/vault";
import { and, eq, inArray, lte, ne } from "drizzle-orm";

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
	const others = await db
		.select({ endpoint: pushSubscription.endpoint })
		.from(pushSubscription)
		.where(
			and(
				eq(pushSubscription.userId, userId),
				ne(pushSubscription.sessionId, sessionId),
			),
		);
	if (
		others.filter((other) => other.endpoint !== endpoint).length >= DEVICE_LIMIT
	)
		return "too-many";

	// The person's own: from this session, or an older one on the same browser.
	if (holder)
		await db
			.delete(pushSubscription)
			.where(eq(pushSubscription.endpoint, endpoint));
	const device = { endpoint, p256dh: keys.p256dh, auth: keys.auth };
	await db
		.insert(pushSubscription)
		.values({ id: newId("psb"), userId, sessionId, ...device })
		.onConflictDoUpdate({
			target: pushSubscription.sessionId,
			set: { ...device, failures: 0 },
		});
	return "saved";
}
