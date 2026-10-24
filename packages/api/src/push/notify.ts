import type { Database } from "@vauly/db";
import { session } from "@vauly/db/schema/auth";
import {
	agent,
	pushSubscription,
	setting,
	vaultAccess,
} from "@vauly/db/schema/vault";
import { and, desc, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

import { atLeast } from "../lib";
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

/**
 * Pushes one call sends at most. Cloudflare's free plan gives a request 50 fetches and
 * 10 ms of CPU, and each push is a fetch and about a quarter of a millisecond of crypto.
 */
export const MAX_SENDS = 25;
/** Failed sends in a row before a device is forgotten. */
export const MAX_FAILURES = 3;
/** Every push is padded to this many bytes, so its size doesn't give its words away. */
export const PAD_TO = 640;
const TIMEOUT = 5_000;

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

type Device = {
	id: string;
	userId: string;
	sessionId: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	failures: number;
};

/**
 * Which devices get which notice, at most MAX_SENDS of them: everyone's newest device
 * first, then everyone's next, so a long list can't leave anyone out. `devices` is
 * newest first.
 */
export function pickSends(
	deliveries: Delivery[],
	devices: Device[],
	{ localhost = false } = {},
) {
	const queues = deliveries.map(({ userId, notice, exceptSession }) =>
		devices
			.filter(
				(device) =>
					device.userId === userId &&
					device.sessionId !== exceptSession &&
					pushServiceAllowed(device.endpoint, { localhost }),
			)
			.map((device) => ({ device, notice })),
	);
	const picked: { device: Device; notice: Notice }[] = [];
	for (let round = 0; picked.length < MAX_SENDS; round++) {
		const next = queues.flatMap((queue) => queue[round] ?? []);
		if (next.length === 0) break;
		picked.push(...next.slice(0, MAX_SENDS - picked.length));
	}
	return picked;
}

/**
 * Sends each notice to its person's devices, those signed in now. `deliveries` may still
 * be on its way: a lookup that fails here fails nothing else. A device whose push service
 * no longer knows it (404 or 410), or that failed MAX_FAILURES times in a row, is
 * forgotten. Never throws.
 */
export async function notify(
	db: Database,
	deliveries: Delivery[] | Promise<Delivery[]>,
	{ subject, localhost = false }: { subject: string; localhost?: boolean },
) {
	try {
		const wanted = await deliveries;
		const userIds = [...new Set(wanted.map((entry) => entry.userId))];
		if (userIds.length === 0) return;
		const devices = await db
			.select({
				id: pushSubscription.id,
				userId: pushSubscription.userId,
				sessionId: pushSubscription.sessionId,
				endpoint: pushSubscription.endpoint,
				p256dh: pushSubscription.p256dh,
				auth: pushSubscription.auth,
				failures: pushSubscription.failures,
			})
			.from(pushSubscription)
			.innerJoin(session, eq(session.id, pushSubscription.sessionId))
			.where(
				and(
					inArray(pushSubscription.userId, userIds),
					gt(session.expiresAt, new Date()),
				),
			)
			.orderBy(desc(pushSubscription.createdAt));
		const sends = pickSends(wanted, devices, { localhost });
		if (sends.length === 0) return;
		const keys = await vapidKeys(db);
		// One signature per push service, not per device.
		const signed = new Map<string, Promise<string>>();
		const authorization = (endpoint: string) => {
			const audience = new URL(endpoint).origin;
			let header = signed.get(audience);
			if (!header) {
				header = vapidAuthorization(endpoint, keys, subject);
				signed.set(audience, header);
			}
			return header;
		};
		const results = await Promise.allSettled(
			sends.map(({ device, notice }) =>
				send(db, device, notice, authorization(device.endpoint)),
			),
		);
		for (const result of results)
			if (result.status === "rejected") console.error(result.reason);
	} catch (error) {
		console.error(error);
	}
}

async function send(
	db: Database,
	device: Device,
	notice: Notice,
	authorization: Promise<string>,
) {
	const { ttl, urgent, ...shown } = notice;
	const body = await encryptPush(
		new TextEncoder().encode(JSON.stringify(shown)),
		device,
		{ padTo: PAD_TO },
	);
	let status = 0;
	try {
		const response = await fetch(device.endpoint, {
			method: "POST",
			headers: {
				Authorization: await authorization,
				"Content-Encoding": "aes128gcm",
				"Content-Type": "application/octet-stream",
				TTL: String(ttl),
				Urgency: urgent ? "high" : "normal",
			},
			body,
			// A push service answers; it never sends a push somewhere else.
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT),
		});
		status = response.status;
		await response.body?.cancel();
	} catch {
		// Unreachable or too slow: a failure like any other.
	}
	const forget = () =>
		db.delete(pushSubscription).where(eq(pushSubscription.id, device.id));
	if (status >= 200 && status < 300) {
		if (device.failures > 0)
			await db
				.update(pushSubscription)
				.set({ failures: 0 })
				.where(eq(pushSubscription.id, device.id));
		return;
	}
	if (status === 404 || status === 410) return forget();
	// Too many pushes for now isn't the device's fault.
	if (status === 429) return;
	console.error(
		`Push to ${new URL(device.endpoint).host} failed: ${status || "no answer"}`,
	);
	if (device.failures + 1 >= MAX_FAILURES) return forget();
	await db
		.update(pushSubscription)
		.set({ failures: device.failures + 1 })
		.where(eq(pushSubscription.id, device.id));
}

/** How often an agent's requests may notify: a stolen token can't keep phones buzzing. */
export const AGENT_QUIET = 5 * 60 * 1000;

/**
 * Who hears about an agent's new requests for items in `vaultIds`: everyone who can
 * change those vaults, with how many of the items they can decide. Nobody, if the agent
 * notified anyone in the last AGENT_QUIET; its requests still wait in the app.
 */
export async function approvalDeliveries(
	db: Database,
	from: { id: string; name: string },
	vaultIds: string[],
): Promise<Delivery[]> {
	if (vaultIds.length === 0) return [];
	const now = new Date();
	const [due] = await db
		.update(agent)
		.set({ notifiedAt: now })
		.where(
			and(
				eq(agent.id, from.id),
				or(
					isNull(agent.notifiedAt),
					lt(agent.notifiedAt, new Date(now.getTime() - AGENT_QUIET)),
				),
			),
		)
		.returning({ id: agent.id });
	if (!due) return [];
	const approvers = await db
		.select({ userId: vaultAccess.userId, vaultId: vaultAccess.vaultId })
		.from(vaultAccess)
		.where(
			and(
				inArray(vaultAccess.vaultId, [...new Set(vaultIds)]),
				inArray(vaultAccess.role, atLeast("edit")),
			),
		);
	const counts = new Map<string, number>();
	for (const vaultId of vaultIds)
		for (const row of approvers)
			if (row.vaultId === vaultId)
				counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
	return [...counts].map(([userId, count]) => ({
		userId,
		notice: approvalNotice(from, count),
	}));
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
