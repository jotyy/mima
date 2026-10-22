// What the extension remembers. The server and the session token live in local storage;
// the unlocked private key only in session storage, which is kept in memory and cleared
// when the browser closes. Content scripts can't read session storage.

export const AUTO_LOCK_MS = 15 * 60 * 1000;

export type Connection = {
	/** The web app address people use, for "Open mima". */
	web: string;
	/** The API address, from the web app's /mima.json. */
	server: string;
	email: string;
	/** The session token, sent as a bearer token. */
	token: string;
};

export type Unlocked = {
	/** The account private key, PKCS#8, base64. */
	privateKey: string;
	publicKey: string;
	lastActive: number;
};

export async function getConnection(): Promise<Partial<Connection>> {
	return (await browser.storage.local.get([
		"web",
		"server",
		"email",
		"token",
	])) as Partial<Connection>;
}

export function saveConnection(values: Partial<Connection>) {
	return browser.storage.local.set(values);
}

export async function forgetConnection() {
	await lock();
	await browser.storage.local.remove(["server", "web", "email", "token"]);
}

/** The unlocked key, or null when locked or idle for too long (which also locks). */
export async function getUnlocked(): Promise<Unlocked | null> {
	const { unlocked } = (await browser.storage.session.get("unlocked")) as {
		unlocked?: Unlocked;
	};
	if (!unlocked) return null;
	if (Date.now() - unlocked.lastActive > AUTO_LOCK_MS) {
		await lock();
		return null;
	}
	return unlocked;
}

export function saveUnlocked(privateKey: string, publicKey: string) {
	return browser.storage.session.set({
		unlocked: { privateKey, publicKey, lastActive: Date.now() },
	});
}

/** Pushes the auto-lock back; called whenever the person uses the popup. */
export async function touch() {
	const unlocked = await getUnlocked();
	if (unlocked) {
		await browser.storage.session.set({
			unlocked: { ...unlocked, lastActive: Date.now() },
		});
	}
}

export function lock() {
	return browser.storage.session.remove("unlocked");
}
