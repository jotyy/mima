import { ORPCError } from "@orpc/server";
import { pushSubscription } from "@vauly/db/schema/vault";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { memberProcedure } from "../index";
import { newId } from "../lib";
import { pushServiceAllowed, vapidKeys } from "../push/notify";
import { validKeys } from "../push/web-push";

// Notifications on this device, for the session it's signed in with. Signing out ends the
// session, and its subscription goes with it.

const endpoint = z.object({ endpoint: z.string().min(1).max(2048) });

export const pushRouter = {
	/** The server's VAPID public key, which the browser subscribes with. */
	publicKey: memberProcedure.handler(
		async ({ context }) => (await vapidKeys(context.db)).publicKey,
	),

	/** Turns notifications on for this device, or moves its subscription to this session. */
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
			if (
				!pushServiceAllowed(input.endpoint, { localhost: context.localPush })
			) {
				throw new ORPCError("BAD_REQUEST", {
					message: "vauly doesn't send notifications to this browser's service",
				});
			}
			if (!(await validKeys(input.keys))) {
				throw new ORPCError("BAD_REQUEST", {
					message: "That isn't a push subscription",
				});
			}
			const owner = {
				userId: context.userId,
				sessionId: context.session.session.id,
				p256dh: input.keys.p256dh,
				auth: input.keys.auth,
			};
			await context.db
				.insert(pushSubscription)
				.values({ id: newId("psb"), endpoint: input.endpoint, ...owner })
				.onConflictDoUpdate({ target: pushSubscription.endpoint, set: owner });
		}),

	/** Turns them off for this device. */
	unsubscribe: memberProcedure
		.input(endpoint)
		.handler(async ({ context, input }) => {
			await context.db
				.delete(pushSubscription)
				.where(
					and(
						eq(pushSubscription.endpoint, input.endpoint),
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
						eq(pushSubscription.endpoint, input.endpoint),
						eq(pushSubscription.sessionId, context.session.session.id),
					),
				);
			return Boolean(row);
		}),
};
