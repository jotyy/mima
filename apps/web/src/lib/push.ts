import { fromBase64Url, toBase64Url } from "@vauly/api/push/web-push";

import { client } from "@/utils/orpc";

// Notifications on this device, by Web Push: the browser subscribes with the server's
// public key, and the server sends to that subscription while this session lasts. What
// a notification says is in packages/api/src/push/notify.ts; src/sw.ts shows it.

/**
 * Whether this browser can get notifications, and if not, why: iPhones and iPads get them
 * only in the app added to the Home Screen, on iOS 16.4 or later.
 */
export type PushSupport = "supported" | "unsupported" | "install" | "blocked";

export function pushSupport(): PushSupport {
	const apple =
		/iPhone|iPad|iPod/.test(navigator.userAgent) ||
		(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	const installed =
		window.matchMedia("(display-mode: standalone)").matches ||
		(navigator as { standalone?: boolean }).standalone === true;
	if (
		!("serviceWorker" in navigator) ||
		!("PushManager" in window) ||
		!("Notification" in window)
	)
		return apple && !installed ? "install" : "unsupported";
	if (Notification.permission === "denied") return "blocked";
	return "supported";
}

export class PushBlockedError extends Error {
	constructor() {
		super(
			"Notifications are blocked for vauly. Allow them in this browser's settings, then try again.",
		);
	}
}

/**
 * One tab at a time: one tab's check mustn't drop the subscription another tab is
 * making, before the server has it. Without Web Locks, as in old browsers, each runs as it
 * comes.
 */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
	return navigator.locks ? navigator.locks.request("vauly.push", work) : work();
}

async function browserSubscription() {
	const registration = await navigator.serviceWorker?.getRegistration();
	return (await registration?.pushManager?.getSubscription()) ?? null;
}

/** The service worker, once it runs; the app registers it as it starts. */
async function serviceWorker() {
	const timeout = new Promise<never>((_, reject) =>
		setTimeout(
			() =>
				reject(
					new Error(
						"vauly's service worker isn't running. Reload the page and try again.",
					),
				),
			10_000,
		),
	);
	return Promise.race([navigator.serviceWorker.ready, timeout]);
}

/**
 * Whether the server sends notifications to this device. A subscription it doesn't
 * know for this session, after a sign-out elsewhere or someone else's sign-in on a
 * shared computer, is dropped here too. The app checks as it starts and on sign-in.
 */
export async function pushEnabled() {
	if (pushSupport() === "unsupported") return false;
	return inTurn(async () => {
		const subscription = await browserSubscription();
		if (!subscription) return false;
		if (await client.push.status({ endpoint: subscription.endpoint }))
			return true;
		await subscription.unsubscribe().catch(() => false);
		return false;
	});
}

/** Turns notifications on here. Call it from the tap itself: iOS asks only then. */
export async function turnOnPush() {
	if ((await Notification.requestPermission()) !== "granted")
		throw new PushBlockedError();
	await inTurn(subscribe);
}

async function subscribe() {
	const [registration, publicKey] = await Promise.all([
		serviceWorker(),
		client.push.publicKey(),
	]);
	let subscription = await registration.pushManager.getSubscription();
	const key = subscription?.options.applicationServerKey;
	// One made with another key, before the workspace started over, can't be used, nor
	// can one the server doesn't have for this session, such as someone else's from
	// before on a shared computer: this browser gets a new one.
	if (
		subscription &&
		(!key ||
			toBase64Url(key) !== publicKey ||
			!(await client.push.status({ endpoint: subscription.endpoint })))
	) {
		await subscription.unsubscribe();
		subscription = null;
	}
	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: fromBase64Url(publicKey),
	});
	const { keys } = subscription.toJSON();
	await client.push.subscribe({
		endpoint: subscription.endpoint,
		keys: { p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
	});
}

/** Turns notifications off here, on the server and in the browser. */
export async function turnOffPush() {
	await inTurn(async () => {
		const subscription = await browserSubscription();
		if (!subscription) return;
		await client.push.unsubscribe({ endpoint: subscription.endpoint });
		await subscription.unsubscribe();
	});
}

/**
 * On signing out: the server forgot this device with the session, and the browser stops
 * listening, so the next person to sign in here turns notifications on for themselves.
 */
export async function forgetPush() {
	try {
		await inTurn(async () => {
			await (await browserSubscription())?.unsubscribe();
		});
	} catch {
		// Nothing to forget.
	}
}
