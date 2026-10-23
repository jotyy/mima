import {
	deviceKey,
	fromBase64,
	openPrivateKey,
	randomBytes,
	sealPrivateKey,
	toBase64,
} from "@vauly/crypto";

// Unlocking with a passkey on this device: Face ID, Touch ID, Windows Hello or the
// device's PIN instead of the master password. Turning it on creates a passkey with the
// WebAuthn PRF extension; its PRF output derives a key that seals a copy of the account's
// private key, kept here in IndexedDB. The server never sees any of it, not even the
// passkey's ID, and unlocking only ever happens inside a session it still accepts.

/** What this device keeps for one account. Everything but `sealedPrivateKey` is public. */
export type DeviceUnlock = {
	accountId: string;
	credentialId: string;
	/** The PRF input; the output depends on it and on the passkey's own secret. */
	prfSalt: string;
	sealedPrivateKey: string;
	/** The account's public key, to notice a copy that no longer belongs to it. */
	publicKey: string;
	/**
	 * The session it was made in. A new sign-in starts without it, so a sign-out that never
	 * finished deleting it, or one that happened while this device was offline, still counts.
	 */
	sessionId: string;
	createdAt: string;
};

/** The browser or the passkey can't give a PRF output, so this device can't do it. */
export class DeviceUnlockUnavailable extends Error {
	constructor() {
		super("This browser can't unlock vauly with a passkey.");
	}
}

/** Whether to offer it: a platform authenticator that verifies the person, and PRF. */
export async function deviceUnlockSupported() {
	if (!window.isSecureContext || !("PublicKeyCredential" in window)) {
		return false;
	}
	try {
		if ("getClientCapabilities" in PublicKeyCredential) {
			const capabilities = await PublicKeyCredential.getClientCapabilities();
			if (capabilities["extension:prf"] === false) return false;
		}
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}

export async function readDeviceUnlock(
	accountId: string,
): Promise<DeviceUnlock | null> {
	try {
		const found = await request<DeviceUnlock | undefined>("readonly", (store) =>
			store.get(accountId),
		);
		return found ?? null;
	} catch {
		return null;
	}
}

/** Deletes this device's copy, and tells the passkey provider the passkey is no longer used. */
export async function forgetDeviceUnlock(accountId: string) {
	const record = await readDeviceUnlock(accountId);
	if (!record) return;
	await request("readwrite", (store) => store.delete(accountId)).catch(
		() => undefined,
	);
	signalUnused(record.credentialId);
}

/** Creates the passkey, then seals the private key with what its PRF gives. */
export async function turnOnDeviceUnlock(account: {
	id: string;
	email: string;
	name: string;
	publicKey: string;
	privateKey: CryptoKey;
	sessionId: string;
}) {
	const prfSalt = randomBytes(32);
	const created = (await navigator.credentials.create({
		publicKey: {
			rp: { id: location.hostname, name: "vauly" },
			user: {
				id: new TextEncoder().encode(account.id),
				name: account.email,
				displayName: account.name,
			},
			challenge: randomBytes(32),
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 },
				{ type: "public-key", alg: -257 },
			],
			authenticatorSelection: {
				authenticatorAttachment: "platform",
				residentKey: "preferred",
				userVerification: "required",
			},
			extensions: { prf: { eval: { first: prfSalt } } },
		},
	})) as PublicKeyCredential | null;
	if (!created) throw new DeviceUnlockUnavailable();
	const credentialId = toBase64Url(new Uint8Array(created.rawId));
	const prf = created.getClientExtensionResults().prf;
	if (!prf?.enabled && !prf?.results) {
		signalUnused(credentialId);
		throw new DeviceUnlockUnavailable();
	}
	// Some authenticators only answer PRF when the passkey is used, not when it's made.
	const output = prf.results?.first
		? bytes(prf.results.first)
		: await prfOutput(credentialId, prfSalt);
	const record: DeviceUnlock = {
		accountId: account.id,
		credentialId,
		prfSalt: toBase64(prfSalt),
		sealedPrivateKey: await sealPrivateKey(
			await deviceKey(output),
			account.privateKey,
		),
		publicKey: account.publicKey,
		sessionId: account.sessionId,
		createdAt: new Date().toISOString(),
	};
	await request("readwrite", (store) => store.put(record));
}

/** Asks for the passkey and opens the private key. Rejects if the person cancels. */
export async function unlockWithDevice(record: DeviceUnlock) {
	const output = await prfOutput(
		record.credentialId,
		fromBase64(record.prfSalt),
	);
	return openPrivateKey(await deviceKey(output), record.sealedPrivateKey);
}

async function prfOutput(credentialId: string, salt: Uint8Array) {
	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: randomBytes(32),
			rpId: location.hostname,
			allowCredentials: [
				{ type: "public-key", id: fromBase64Url(credentialId) },
			],
			userVerification: "required",
			extensions: { prf: { eval: { first: salt as BufferSource } } },
		},
	})) as PublicKeyCredential | null;
	const first = assertion?.getClientExtensionResults().prf?.results?.first;
	if (!first) throw new DeviceUnlockUnavailable();
	return bytes(first);
}

function signalUnused(credentialId: string) {
	if (!("signalUnknownCredential" in PublicKeyCredential)) return;
	PublicKeyCredential.signalUnknownCredential({
		rpId: location.hostname,
		credentialId,
	}).catch(() => undefined);
}

const bytes = (source: BufferSource) =>
	source instanceof ArrayBuffer
		? new Uint8Array(source)
		: new Uint8Array(source.buffer, source.byteOffset, source.byteLength);

const toBase64Url = (data: Uint8Array) =>
	toBase64(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromBase64Url = (text: string) => {
	const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
	return fromBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
};

// --- IndexedDB -------------------------------------------------------------------------

const DATABASE = "vauly";
const STORE = "deviceUnlock";

function request<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const opening = indexedDB.open(DATABASE, 1);
		opening.onupgradeneeded = () => {
			opening.result.createObjectStore(STORE, { keyPath: "accountId" });
		};
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const transaction = database.transaction(STORE, mode);
			const result = work(transaction.objectStore(STORE));
			transaction.oncomplete = () => {
				database.close();
				resolve(result.result);
			};
			transaction.onerror = () => {
				database.close();
				reject(transaction.error);
			};
		};
	});
}
