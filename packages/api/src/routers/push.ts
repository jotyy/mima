import { ORPCError } from "@orpc/server";
import { pushSubscription } from "@vauly/db/schema/vault";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { vapidKeys } from "../push/notify";
import {
	DEVICE_LIMIT,
	normalEndpoint,
	type SaveResult,
	saveSubscription,
} from "../push/subscriptions";

// Notifications on this device, for the session it's signed in with. Signing out ends the
// session, and its subscription goes with it.

const endpoint = z.object({ endpoint: z.string().min(1).max(2048) });

const refusals: Record<Exclude<SaveResult, "saved">, string> = {
	"not-a-push-service":
		"vauly doesn't send notifications to this browser's service",
	"not-a-subscription": "That isn't a push subscription",
	"someone-else":
		"This browser's notifications belong to another sign-in. Turn notifications off and on again.",
	"too-many": `You get notifications on ${DEVICE_LIMIT} devices already. Turn them off on one first.`,
};

export const pushRouter = {
	/** The server's VAPID public key, which the browser subscribes with. */
	publicKey: memberProcedure.handler(
		async ({ context }) => (await vapidKeys(context.db)).publicKey,
	),

	/** Turns notifications on for this device, in place of where this session had them. */
	subscribe: memberProcedure
		.input(
			endpoint.extend({
				keys: z.object({
					p256dh: z.string().min(1).max(128),
					auth: z.string().min(1).max(64),
				}),
			}),
		)
		.handler(async ({ context, input }) => {
			const result = await saveSubscription(
				context.db,
				{
					userId: context.userId,
					sessionId: context.session.session.id,
					endpoint: input.endpoint,
					keys: input.keys,
				},
				{ localhost: context.localPush },
			);
			if (result === "saved") return;
			throw new ORPCError(
				result === "someone-else" || result === "too-many"
					? "CONFLICT"
					: "BAD_REQUEST",
				{ message: refusals[result] },
			);
		}),

	/** Turns them off for this device. */
	unsubscribe: memberProcedure
		.input(endpoint)
		.handler(async ({ context, input }) => {
			await context.db
				.delete(pushSubscription)
				.where(
					and(
						eq(pushSubscription.endpoint, normalEndpoint(input.endpoint) ?? ""),
						eq(pushSubscription.userId, context.userId),
					),
				);
		}),

	/** Whether the server sends to this device for the session it's signed in with. */
	status: memberProcedure
		.input(endpoint)
		.handler(async ({ context, input }) => {
			const [row] = await context.db
				.select({ id: pushSubscription.id })
				.from(pushSubscription)
				.where(
					and(
						eq(pushSubscription.endpoint, normalEndpoint(input.endpoint) ?? ""),
						eq(pushSubscription.sessionId, context.session.session.id),
					),
				);
			return Boolean(row);
		}),
};
