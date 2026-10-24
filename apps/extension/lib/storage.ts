// What the extension remembers. The server and the session token live in local storage;
// the unlocked private key only in session storage, which is kept in memory and cleared
// when the browser closes. Content scripts can't read session storage.

export const AUTO_LOCK_MS = 15 * 60 * 1000;
/** How long after the master password was entered a passkey counts the person as verified. */
export const VERIFIED_MS = 5 * 60 * 1000;

export type Connection = {
	/** The web app address people use, for "Open vauly". */
	web: string;
	/** The API address, from the web app's /vauly.json. */
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
	/** When the master password was last entered. */
	verifiedAt: number;
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

/**
 * The accounts this extension has seen use Argon2id, by email, so that a server asking
 * one of them for PBKDF2 again is refused.
 */
export async function argon2idSeen(email: string) {
	const { argon2id = [] } = (await browser.storage.local.get("argon2id")) as {
		argon2id?: string[];
	};
	return argon2id.includes(email.trim().toLowerCase());
}

export async function rememberArgon2id(email: string) {
	const { argon2id = [] } = (await browser.storage.local.get("argon2id")) as {
		argon2id?: string[];
	};
	const id = email.trim().toLowerCase();
	if (!argon2id.includes(id)) {
		await browser.storage.local.set({ argon2id: [...argon2id, id] });
	}
}

export async function forgetConnection() {
	await lock();
	await browser.storage.local.remove([
		"server",
		"web",
		"email",
		"token",
		"brandfetch",
	]);
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

/** Called right after the master password checked out. */
export function saveUnlocked(privateKey: string, publicKey: string) {
	const now = Date.now();
	return browser.storage.session.set({
		unlocked: { privateKey, publicKey, lastActive: now, verifiedAt: now },
	});
}

/** Whether the master password was entered in the last few minutes. */
export async function recentlyVerified() {
	const unlocked = await getUnlocked();
	return Boolean(
		unlocked && Date.now() - (unlocked.verifiedAt ?? 0) < VERIFIED_MS,
	);
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
