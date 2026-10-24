import type { Database } from "@vauly/db";
import { session } from "@vauly/db/schema/auth";
import { pushSubscription, setting } from "@vauly/db/schema/vault";
import { and, eq, gt, inArray } from "drizzle-orm";

import {
	encryptPush,
	newVapidKeys,
	type VapidKeys,
	vapidAuthorization,
} from "./web-push";

// Notifications on people's devices. The server can't read item or vault names, so a
// notification never has one: it says what happened and who did it, and opens the app.

/** What a notification says, and where in the app tapping it goes. */
export type Notice = {
	title: string;
	body: string;
	/** A path in the app. */
	url: string;
	/** A later notification with the same tag replaces this one on the device. */
	tag: string;
	/** Wakes the device for it, where the push service can tell. */
	urgent?: boolean;
	/** How long the push service keeps trying to deliver it, in seconds. */
	ttl: number;
};

/** A notice for one person's devices, except the session it's about, if any. */
export type Delivery = {
	userId: string;
	notice: Notice;
	exceptSession?: string;
};

const KEYS = "vapid_keys";

/**
 * The server's VAPID key pair. The first device to turn notifications on makes it, kept
 * in `setting` like the session secret: whichever Worker writes first wins.
 */
export async function vapidKeys(db: Database): Promise<VapidKeys> {
	const read = async () => {
		const [row] = await db
			.select({ value: setting.value })
			.from(setting)
			.where(eq(setting.key, KEYS));
		return row ? (JSON.parse(row.value) as VapidKeys) : null;
	};
	const stored = await read();
	if (stored) return stored;
	await db
		.insert(setting)
		.values({ key: KEYS, value: JSON.stringify(await newVapidKeys()) })
		.onConflictDoNothing();
	const made = await read();
	if (!made) throw new Error("No VAPID keys in the database");
	return made;
}

// The push services of the browsers vauly runs in. A subscription elsewhere is refused,
// so nobody can have the server post to an address of their choosing.
const services = [
	/^fcm\.googleapis\.com$/,
	/^updates\.push\.services\.mozilla\.com$/,
	/^web\.push\.apple\.com$/,
	/^[a-z0-9-]+\.notify\.windows\.com$/,
];

/**
 * Whether vauly sends to `endpoint`: https on a browser's push service, or with
 * `localhost`, which only the e2e stack allows, the stand-in service its tests run.
 */
export function pushServiceAllowed(
	endpoint: string,
	{ localhost = false } = {},
) {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.username || url.password) return false;
	if (localhost && url.protocol === "http:" && url.hostname === "localhost")
		return true;
	return (
		url.protocol === "https:" &&
		url.port === "" &&
		services.some((service) => service.test(url.hostname))
	);
}

/**
 * Sends each notice to its person's devices, those signed in now. A device its push
 * service no longer knows (404 or 410) is forgotten. Never throws: a notification that
 * can't go out mustn't fail what caused it.
 */
export async function notify(
	db: Database,
	deliveries: Delivery[],
	{ subject, localhost = false }: { subject: string; localhost?: boolean },
) {
	try {
		const userIds = [...new Set(deliveries.map((entry) => entry.userId))];
		if (userIds.length === 0) return;
		const devices = await db
			.select({
				id: pushSubscription.id,
				userId: pushSubscription.userId,
				sessionId: pushSubscription.sessionId,
				endpoint: pushSubscription.endpoint,
				p256dh: pushSubscription.p256dh,
				auth: pushSubscription.auth,
			})
			.from(pushSubscription)
			.innerJoin(session, eq(session.id, pushSubscription.sessionId))
			.where(
				and(
					inArray(pushSubscription.userId, userIds),
					gt(session.expiresAt, new Date()),
				),
			);
		if (devices.length === 0) return;
		const keys = await vapidKeys(db);
		const sends = deliveries.flatMap(({ userId, notice, exceptSession }) =>
			devices
				.filter(
					(device) =>
						device.userId === userId &&
						device.sessionId !== exceptSession &&
						pushServiceAllowed(device.endpoint, { localhost }),
				)
				.map(async (device) => {
					const { ttl, urgent, ...shown } = notice;
					const body = await encryptPush(
						new TextEncoder().encode(JSON.stringify(shown)),
						device,
					);
					const response = await fetch(device.endpoint, {
						method: "POST",
						headers: {
							Authorization: await vapidAuthorization(
								device.endpoint,
								keys,
								subject,
							),
							"Content-Encoding": "aes128gcm",
							"Content-Type": "application/octet-stream",
							TTL: String(ttl),
							Urgency: urgent ? "high" : "normal",
						},
						body,
					});
					if (response.status === 404 || response.status === 410) {
						await db
							.delete(pushSubscription)
							.where(eq(pushSubscription.id, device.id));
					} else if (!response.ok) {
						console.error(
							`Push to ${new URL(device.endpoint).host} failed: ${response.status}`,
						);
					}
				}),
		);
		const results = await Promise.allSettled(sends);
		for (const result of results)
			if (result.status === "rejected") console.error(result.reason);
	} catch (error) {
		console.error(error);
	}
}

/** What an agent's request tells the people who can approve it. */
export function approvalNotice(
	agent: { id: string; name: string },
	count: number,
): Notice {
	return {
		title: `${agent.name} wants to use ${count === 1 ? "1 item" : `${count} items`}`,
		body: "Open vauly to approve or deny.",
		url: "/agents",
		tag: `approval:${agent.id}`,
		urgent: true,
		// `vauly run` waits five minutes; past an hour the request is old news.
		ttl: 60 * 60,
	};
}

/** What a new sign-in, as `sessionId`, tells the account's other devices. */
export function signInNotice(device: string, sessionId: string): Notice {
	return {
		title: "New sign-in to your vauly",
		body: `${device}. If this wasn't you, sign it out in Settings.`,
		url: "/settings",
		tag: `sign-in:${sessionId}`,
		ttl: 24 * 60 * 60,
	};
}
