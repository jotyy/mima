import { useQueryClient } from "@tanstack/react-query";
import {
	type AccountKeys,
	changeMasterPassword,
	createAccount,
	deriveMasterKeys,
	newDataKey,
	openPrivateKey,
	sealJson,
	unwrapKeyFrom,
	wrapKeyFor,
} from "@vauly/crypto";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { notify } from "@/components/notify";
import { authClient } from "@/lib/auth-client";
import {
	forgetDeviceUnlock,
	readDeviceUnlock,
	turnOnDeviceUnlock,
	unlockWithDevice,
} from "@/lib/device-unlock";
import { client, SESSION_ENDED } from "@/utils/orpc";

// The keyring holds the unlocked private key and the vault keys in memory only. A reload,
// "Lock" or a few idle minutes forget them; the session cookie alone opens nothing.

/** Idle minutes before the vault locks. Each device keeps its own choice. */
export const AUTO_LOCK_CHOICES = [5, 15, 30, 60, 240] as const;
export type AutoLockMinutes = (typeof AUTO_LOCK_CHOICES)[number];
const AUTO_LOCK_KEY = "vauly.autoLockMinutes";

function storedAutoLock(): AutoLockMinutes {
	try {
		const value = Number(localStorage.getItem(AUTO_LOCK_KEY));
		return AUTO_LOCK_CHOICES.find((choice) => choice === value) ?? 15;
	} catch {
		return 15;
	}
}

export type Me = {
	id: string;
	name: string;
	email: string;
	role: "owner" | "admin" | "member";
	twoStep: boolean;
	recoveryCodesLeft: number;
	keys: AccountKeys;
};

type Status = "loading" | "signed-out" | "locked" | "unlocked";

type Keyring = {
	status: Status;
	me: Me | null;
	/** Bumped on every lock, so decrypted queries never outlive the keys. */
	epoch: number;
	locksAt: number | null;
	/** With two-step login on, the second try carries the code. */
	signIn: (email: string, password: string, code?: string) => Promise<void>;
	unlock: (password: string) => Promise<void>;
	/** Whether this device keeps a passkey-sealed copy of the private key for this account. */
	deviceUnlock: boolean;
	/** Unlocks with that passkey. Rejects with a NotAllowedError if the person cancels. */
	unlockWithPasskey: () => Promise<void>;
	/** Turns on unlocking with a passkey here, after checking the master password. */
	turnOnDeviceUnlock: (password: string) => Promise<void>;
	turnOffDeviceUnlock: () => Promise<void>;
	register: (input: {
		email: string;
		name: string;
		password: string;
		inviteToken?: string;
		workspaceName?: string;
		setupCode?: string;
	}) => Promise<void>;
	lock: () => void;
	signOut: () => Promise<void>;
	vaultKey: (vaultId: string, wrappedKey: string) => Promise<CryptoKey>;
	/** Checks the master password without changing anything, before a sensitive step. */
	verifyPassword: (password: string) => Promise<boolean>;
	changePassword: (current: string, next: string) => Promise<void>;
	rename: (name: string) => Promise<void>;
	/** Loads the profile again, after something about the account changed. */
	reloadMe: () => Promise<void>;
	autoLockMinutes: AutoLockMinutes;
	setAutoLockMinutes: (minutes: AutoLockMinutes) => void;
};

const KeyringContext = createContext<Keyring | null>(null);

export function useKeyring() {
	const value = useContext(KeyringContext);
	if (!value) throw new Error("useKeyring must be used inside KeyringProvider");
	return value;
}

export class WrongPasswordError extends Error {
	constructor() {
		super("That master password doesn't open this account");
	}
}

/** The password was right, and the account asks for a code too: none yet, or a wrong one. */
export class TwoStepError extends Error {
	constructor(readonly wrongCode: boolean) {
		super(
			wrongCode
				? "That code didn't work"
				: "Enter the code from your authenticator app",
		);
	}
}

const privateVaultMeta = {
	name: "Private",
	description: "Only you can open this vault.",
	tone: "violet",
};

export function KeyringProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [status, setStatus] = useState<Status>("loading");
	const [me, setMe] = useState<Me | null>(null);
	const [epoch, setEpoch] = useState(0);
	const [lastActive, setLastActive] = useState(() => Date.now());
	const [autoLockMinutes, setAutoLock] = useState(storedAutoLock);
	const autoLockMs = autoLockMinutes * 60_000;
	const privateKey = useRef<CryptoKey | null>(null);
	const vaultKeys = useRef(new Map<string, Promise<CryptoKey>>());
	const [deviceUnlock, setDeviceUnlock] = useState(false);
	const meRef = useRef(me);
	meRef.current = me;

	// This device's passkey copy, if there is one and it still belongs to this account and
	// this session.
	useEffect(() => {
		if (!me) return setDeviceUnlock(false);
		let cancelled = false;
		(async () => {
			const record = await readDeviceUnlock(me.id);
			const session = record ? await authClient.getSession() : null;
			const current =
				record?.publicKey === me.keys.publicKey &&
				record.sessionId === session?.data?.session.id;
			if (record && !current) await forgetDeviceUnlock(me.id);
			if (!cancelled) setDeviceUnlock(current);
		})();
		return () => {
			cancelled = true;
		};
	}, [me]);

	/** Drops this device's passkey copy, on sign-out and when the password changes. */
	const forgetDevice = useCallback(async (accountId: string | undefined) => {
		setDeviceUnlock(false);
		if (accountId) await forgetDeviceUnlock(accountId);
	}, []);

	const loadMe = useCallback(async () => {
		const profile = (await client.account.me()) as Me;
		setMe(profile);
		return profile;
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const session = await authClient.getSession();
			if (cancelled) return;
			if (!session.data) return setStatus("signed-out");
			try {
				await loadMe();
				if (!cancelled) setStatus("locked");
			} catch {
				if (!cancelled) setStatus("signed-out");
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [loadMe]);

	const open = useCallback((key: CryptoKey) => {
		privateKey.current = key;
		vaultKeys.current.clear();
		setLastActive(Date.now());
		setStatus("unlocked");
	}, []);

	const lock = useCallback(() => {
		privateKey.current = null;
		vaultKeys.current.clear();
		queryClient.removeQueries({ queryKey: ["vault"] });
		setEpoch((n) => n + 1);
		setStatus((current) => (current === "unlocked" ? "locked" : current));
	}, [queryClient]);

	const signIn = useCallback(
		async (email: string, password: string, code?: string) => {
			const { kdfSalt, kdfIterations } = await client.account.prelogin({
				email,
			});
			const { authKey, wrapKey } = await deriveMasterKeys(
				password,
				kdfSalt,
				kdfIterations,
			);
			const result = await authClient.signIn.email(
				{ email, password: authKey },
				code ? { headers: { "x-vauly-code": code } } : undefined,
			);
			if (result.error?.code === "TWO_FACTOR_REQUIRED")
				throw new TwoStepError(false);
			if (result.error?.code === "TWO_FACTOR_WRONG")
				throw new TwoStepError(true);
			if (result.error) throw new WrongPasswordError();
			const profile = await loadMe();
			open(await openPrivateKey(wrapKey, profile.keys.encryptedPrivateKey));
		},
		[loadMe, open],
	);

	const unlock = useCallback(
		async (password: string) => {
			if (!me) throw new Error("Sign in first");
			const { wrapKey } = await deriveMasterKeys(
				password,
				me.keys.kdfSalt,
				me.keys.kdfIterations,
			);
			try {
				open(await openPrivateKey(wrapKey, me.keys.encryptedPrivateKey));
			} catch {
				throw new WrongPasswordError();
			}
		},
		[me, open],
	);

	const unlockWithPasskey = useCallback(async () => {
		if (!me) throw new Error("Sign in first");
		const record = await readDeviceUnlock(me.id);
		if (!record) {
			setDeviceUnlock(false);
			throw new Error("This device has no passkey for vauly any more.");
		}
		let key: CryptoKey;
		try {
			key = await unlockWithDevice(record);
		} catch (err) {
			// A cancel leaves everything as it was; anything else means the copy is no good.
			const cancelled =
				err instanceof DOMException &&
				(err.name === "NotAllowedError" || err.name === "AbortError");
			if (!cancelled) await forgetDevice(me.id);
			throw err;
		}
		open(key);
	}, [me, open, forgetDevice]);

	const register = useCallback<Keyring["register"]>(
		async ({
			email,
			name,
			password,
			inviteToken,
			workspaceName,
			setupCode,
		}) => {
			const account = await createAccount(password);
			const vaultKey = await newDataKey();
			await client.account.register({
				email,
				name,
				authKey: account.authKey,
				keys: account.keys,
				inviteToken,
				workspaceName,
				setupCode,
				personalVault: {
					encryptedMeta: await sealJson(vaultKey, privateVaultMeta),
					wrappedKey: await wrapKeyFor(account.keys.publicKey, vaultKey),
				},
			});
			const result = await authClient.signIn.email({
				email,
				password: account.authKey,
			});
			if (result.error)
				throw new Error(result.error.message ?? "Couldn't sign in");
			await loadMe();
			open(account.privateKey);
		},
		[loadMe, open],
	);

	// Another device signed this one out, or an admin removed the person: start over.
	const statusRef = useRef(status);
	statusRef.current = status;
	useEffect(() => {
		const ended = () => {
			if (statusRef.current !== "locked" && statusRef.current !== "unlocked")
				return;
			forgetDevice(meRef.current?.id);
			lock();
			setMe(null);
			setStatus("signed-out");
			notify.error("You were signed out", "Sign in again to keep going.");
		};
		window.addEventListener(SESSION_ENDED, ended);
		return () => window.removeEventListener(SESSION_ENDED, ended);
	}, [lock, forgetDevice]);

	const signOut = useCallback(async () => {
		lock();
		await Promise.all([forgetDevice(meRef.current?.id), authClient.signOut()]);
		setMe(null);
		setStatus("signed-out");
	}, [lock, forgetDevice]);

	const verifyPassword = useCallback(
		async (password: string) => {
			if (!me) return false;
			const { wrapKey } = await deriveMasterKeys(
				password,
				me.keys.kdfSalt,
				me.keys.kdfIterations,
			);
			try {
				await openPrivateKey(wrapKey, me.keys.encryptedPrivateKey);
				return true;
			} catch {
				return false;
			}
		},
		[me],
	);

	const changePassword = useCallback(
		async (current: string, next: string) => {
			if (!me) throw new Error("Sign in first");
			let changed: Awaited<ReturnType<typeof changeMasterPassword>>;
			try {
				changed = await changeMasterPassword(current, next, me.keys);
			} catch {
				throw new WrongPasswordError();
			}
			await client.account.changePassword({
				currentAuthKey: changed.currentAuthKey,
				authKey: changed.authKey,
				keys: {
					kdfSalt: changed.keys.kdfSalt,
					kdfIterations: changed.keys.kdfIterations,
					encryptedPrivateKey: changed.keys.encryptedPrivateKey,
				},
			});
			// The key pair stays the same, so a passkey copy would outlive the old password.
			await forgetDevice(me.id);
			await loadMe();
		},
		[me, loadMe, forgetDevice],
	);

	const turnOnPasskey = useCallback(
		async (password: string) => {
			const key = privateKey.current;
			if (!me || !key) throw new Error("Unlock vauly first");
			if (!(await verifyPassword(password))) throw new WrongPasswordError();
			const session = await authClient.getSession();
			if (!session.data) throw new Error("Sign in again first");
			await turnOnDeviceUnlock({
				sessionId: session.data.session.id,
				id: me.id,
				email: me.email,
				name: me.name,
				publicKey: me.keys.publicKey,
				privateKey: key,
			});
			setDeviceUnlock(true);
		},
		[me, verifyPassword],
	);

	const turnOffPasskey = useCallback(
		() => forgetDevice(me?.id),
		[me, forgetDevice],
	);

	const rename = useCallback(
		async (name: string) => {
			await client.account.updateProfile({ name });
			await loadMe();
			await queryClient.invalidateQueries();
		},
		[loadMe, queryClient],
	);

	const reloadMe = useCallback(async () => {
		await loadMe();
	}, [loadMe]);

	const setAutoLockMinutes = useCallback((minutes: AutoLockMinutes) => {
		setAutoLock(minutes);
		setLastActive(Date.now());
		try {
			localStorage.setItem(AUTO_LOCK_KEY, String(minutes));
		} catch {
			// Private windows can refuse storage; the choice still holds for this tab.
		}
	}, []);

	const vaultKey = useCallback(
		(vaultId: string, wrappedKey: string) => {
			const key = privateKey.current;
			if (!key || !me) return Promise.reject(new Error("Locked"));
			let cached = vaultKeys.current.get(vaultId);
			if (!cached) {
				cached = unwrapKeyFrom(key, me.keys.publicKey, wrappedKey);
				vaultKeys.current.set(vaultId, cached);
			}
			return cached;
		},
		[me],
	);

	// Auto-lock after the chosen number of idle minutes.
	useEffect(() => {
		if (status !== "unlocked") return;
		let last = Date.now();
		const touch = () => {
			const now = Date.now();
			if (now - last > 5_000) {
				last = now;
				setLastActive(now);
			}
		};
		const events = ["pointerdown", "keydown", "wheel"] as const;
		for (const name of events)
			window.addEventListener(name, touch, { passive: true });
		const timer = setInterval(() => {
			if (Date.now() - last > autoLockMs) lock();
		}, 10_000);
		return () => {
			for (const name of events) window.removeEventListener(name, touch);
			clearInterval(timer);
		};
	}, [status, lock, autoLockMs]);

	const value = useMemo<Keyring>(
		() => ({
			status,
			me,
			epoch,
			locksAt: status === "unlocked" ? lastActive + autoLockMs : null,
			signIn,
			unlock,
			deviceUnlock,
			unlockWithPasskey,
			turnOnDeviceUnlock: turnOnPasskey,
			turnOffDeviceUnlock: turnOffPasskey,
			register,
			lock,
			signOut,
			vaultKey,
			verifyPassword,
			changePassword,
			rename,
			reloadMe,
			autoLockMinutes,
			setAutoLockMinutes,
		}),
		[
			autoLockMs,
			autoLockMinutes,
			verifyPassword,
			changePassword,
			rename,
			reloadMe,
			setAutoLockMinutes,
			status,
			me,
			epoch,
			lastActive,
			signIn,
			unlock,
			deviceUnlock,
			unlockWithPasskey,
			turnOnPasskey,
			turnOffPasskey,
			register,
			lock,
			signOut,
			vaultKey,
		],
	);

	return (
		<KeyringContext.Provider value={value}>{children}</KeyringContext.Provider>
	);
}
