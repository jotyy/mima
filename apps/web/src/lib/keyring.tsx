import {
	type AccountKeys,
	createAccount,
	deriveMasterKeys,
	newDataKey,
	openPrivateKey,
	sealJson,
	unwrapKeyFrom,
	wrapKeyFor,
} from "@mima/crypto";
import { useQueryClient } from "@tanstack/react-query";
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

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

// The keyring holds the unlocked private key and the vault keys in memory only. A reload,
// "Lock" or 15 idle minutes forget them; the session cookie alone opens nothing.

export const AUTO_LOCK_MS = 15 * 60 * 1000;

export type Me = {
	id: string;
	name: string;
	email: string;
	role: "owner" | "admin" | "member";
	keys: AccountKeys;
};

type Status = "loading" | "signed-out" | "locked" | "unlocked";

type Keyring = {
	status: Status;
	me: Me | null;
	/** Bumped on every lock, so decrypted queries never outlive the keys. */
	epoch: number;
	locksAt: number | null;
	signIn: (email: string, password: string) => Promise<void>;
	unlock: (password: string) => Promise<void>;
	register: (input: {
		email: string;
		name: string;
		password: string;
		inviteToken?: string;
		workspaceName?: string;
	}) => Promise<void>;
	lock: () => void;
	signOut: () => Promise<void>;
	vaultKey: (vaultId: string, wrappedKey: string) => Promise<CryptoKey>;
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
	const privateKey = useRef<CryptoKey | null>(null);
	const vaultKeys = useRef(new Map<string, Promise<CryptoKey>>());

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
		async (email: string, password: string) => {
			const { kdfSalt, kdfIterations } = await client.account.prelogin({
				email,
			});
			const { authKey, wrapKey } = await deriveMasterKeys(
				password,
				kdfSalt,
				kdfIterations,
			);
			const result = await authClient.signIn.email({
				email,
				password: authKey,
			});
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

	const register = useCallback<Keyring["register"]>(
		async ({ email, name, password, inviteToken, workspaceName }) => {
			const account = await createAccount(password);
			const vaultKey = await newDataKey();
			await client.account.register({
				email,
				name,
				authKey: account.authKey,
				keys: account.keys,
				inviteToken,
				workspaceName,
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

	const signOut = useCallback(async () => {
		lock();
		await authClient.signOut();
		setMe(null);
		setStatus("signed-out");
	}, [lock]);

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

	// Auto-lock after 15 idle minutes.
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
			if (Date.now() - last > AUTO_LOCK_MS) lock();
		}, 10_000);
		return () => {
			for (const name of events) window.removeEventListener(name, touch);
			clearInterval(timer);
		};
	}, [status, lock]);

	const value = useMemo<Keyring>(
		() => ({
			status,
			me,
			epoch,
			locksAt: status === "unlocked" ? lastActive + AUTO_LOCK_MS : null,
			signIn,
			unlock,
			register,
			lock,
			signOut,
			vaultKey,
		}),
		[
			status,
			me,
			epoch,
			lastActive,
			signIn,
			unlock,
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
