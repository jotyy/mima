import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import {
	type AccountKeys,
	changeMasterPassword,
	createAccount,
	deriveMasterKeys,
	newDataKey,
	openPrivateKey,
	open as openSealed,
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
	type DeviceUnlock,
	type Enrolment,
	expiresAt,
	forgetDeviceUnlocks,
	isCancel,
	readDeviceUnlock,
	startEnrolment,
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
	/** When that copy stops working and the master password is needed again. */
	deviceUnlockUntil: Date | null;
	/** Whether a copy just ran out, so the unlock screen can say why the passkey is gone. */
	deviceUnlockExpired: boolean;
	/** Unlocks with that passkey. Rejects with a PasskeyUnlockError. */
	unlockWithPasskey: () => Promise<void>;
	/** Checks the master password, then hands over the steps that make the passkey. */
	startDeviceUnlock: (password: string) => Promise<Enrolment>;
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

/** Why a passkey didn't unlock: only "expired" and "broken" mean the copy is gone. */
export class PasskeyUnlockError extends Error {
	constructor(readonly reason: "cancelled" | "expired" | "offline" | "broken") {
		super(`Passkey unlock ${reason}`);
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
	const [deviceRecord, setDeviceRecord] = useState<DeviceUnlock | null>(null);
	const [deviceExpired, setDeviceExpired] = useState(false);
	/** The current session's ID; undefined while it couldn't be checked. */
	const sessionId = useRef<string | null | undefined>(undefined);

	/**
	 * Looks the session up, and drops passkey copies made in any other: their sessions are
	 * over, from a sign-out here or elsewhere, an expiry, or a removal. If the session
	 * can't be checked (no network), nothing is dropped.
	 */
	const adoptSession = useCallback(async () => {
		const session = await authClient.getSession();
		if (session.error) {
			sessionId.current = undefined;
			return session;
		}
		const current = session.data?.session.id ?? null;
		sessionId.current = current;
		await forgetDeviceUnlocks((record) => record.sessionId !== current);
		return session;
	}, []);

	// This account's passkey copy on this device, if it belongs to this session, to this
	// key pair, and hasn't run out.
	useEffect(() => {
		if (!me) {
			setDeviceRecord(null);
			return;
		}
		let cancelled = false;
		(async () => {
			const record = await readDeviceUnlock(me.id);
			if (!record || sessionId.current === undefined) {
				if (!cancelled) setDeviceRecord(null);
				return;
			}
			const expired = Date.now() >= expiresAt(record).getTime();
			const valid =
				!expired &&
				record.sessionId === sessionId.current &&
				record.publicKey === me.keys.publicKey;
			if (!valid) {
				await forgetDeviceUnlocks((stale) => stale.accountId === me.id);
			}
			if (cancelled) return;
			setDeviceRecord(valid ? record : null);
			if (expired) setDeviceExpired(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [me]);

	/** Drops passkey copies: this account's, or every one on this device. */
	const forgetDevice = useCallback(async (accountId?: string) => {
		setDeviceRecord(null);
		await forgetDeviceUnlocks((record) =>
			accountId ? record.accountId === accountId : true,
		);
	}, []);

	const loadMe = useCallback(async () => {
		const profile = (await client.account.me()) as Me;
		setMe(profile);
		return profile;
	}, []);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const session = await adoptSession();
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
	}, [loadMe, adoptSession]);

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
			await adoptSession();
			const profile = await loadMe();
			open(await openPrivateKey(wrapKey, profile.keys.encryptedPrivateKey));
		},
		[loadMe, open, adoptSession],
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
		const record = deviceRecord;
		if (!me || !record) throw new PasskeyUnlockError("broken");
		let key: CryptoKey;
		try {
			key = await unlockWithDevice(record, {
				id: me.id,
				publicKey: me.keys.publicKey,
			});
		} catch (err) {
			// A cancel, a passkey that's gone (browsers report both the same way) or no
			// network leave the copy; a server that refuses it, or a copy that won't open,
			// end it.
			if (isCancel(err)) throw new PasskeyUnlockError("cancelled");
			if (err instanceof ORPCError && err.code === "FORBIDDEN") {
				await forgetDevice(me.id);
				setDeviceExpired(true);
				throw new PasskeyUnlockError("expired");
			}
			if (err instanceof ORPCError || err instanceof TypeError) {
				throw new PasskeyUnlockError("offline");
			}
			await forgetDevice(me.id);
			throw new PasskeyUnlockError("broken");
		}
		open(key);
	}, [me, deviceRecord, open, forgetDevice]);

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
			await adoptSession();
			await loadMe();
			open(account.privateKey);
		},
		[loadMe, open, adoptSession],
	);

	// Another device signed this one out, or an admin removed the person: start over.
	const statusRef = useRef(status);
	statusRef.current = status;
	useEffect(() => {
		const ended = () => {
			if (statusRef.current !== "locked" && statusRef.current !== "unlocked")
				return;
			sessionId.current = null;
			forgetDevice();
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
		sessionId.current = null;
		await Promise.all([forgetDevice(), authClient.signOut()]);
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
			await forgetDevice();
			await loadMe();
		},
		[me, loadMe, forgetDevice],
	);

	const startDeviceUnlock = useCallback(
		async (password: string): Promise<Enrolment> => {
			if (!me) throw new Error("Sign in first");
			const session = sessionId.current;
			if (!session) {
				throw new Error(
					"vauly couldn't check this session. Reload the page and try again.",
				);
			}
			const { wrapKey } = await deriveMasterKeys(
				password,
				me.keys.kdfSalt,
				me.keys.kdfIterations,
			);
			let privateKeyPkcs8: Uint8Array;
			try {
				privateKeyPkcs8 = await openSealed(
					wrapKey,
					me.keys.encryptedPrivateKey,
				);
			} catch {
				throw new WrongPasswordError();
			}
			const enrolment = startEnrolment(
				{
					id: me.id,
					email: me.email,
					name: me.name,
					publicKey: me.keys.publicKey,
					sessionId: session,
				},
				privateKeyPkcs8,
			);
			const saved = async () => {
				setDeviceRecord(await readDeviceUnlock(me.id));
				setDeviceExpired(false);
			};
			return {
				create: async () => {
					const step = await enrolment.create();
					if (step === "done") await saved();
					return step;
				},
				confirm: async () => {
					await enrolment.confirm();
					await saved();
				},
				cancel: enrolment.cancel,
			};
		},
		[me],
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
			deviceUnlock: deviceRecord !== null,
			deviceUnlockUntil: deviceRecord ? expiresAt(deviceRecord) : null,
			deviceUnlockExpired: deviceExpired,
			unlockWithPasskey,
			startDeviceUnlock,
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
			deviceRecord,
			deviceExpired,
			unlockWithPasskey,
			startDeviceUnlock,
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
