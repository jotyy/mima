import { parse } from "tldts";

import { fromBase64Url, toBase64Url } from "./base64url";

// vauly as a WebAuthn authenticator. The extension makes and uses passkeys for the sites
// people sign in to; each one lives inside a login item, encrypted like its password.
// Nothing here talks to a page or the server: the background calls it with the page's
// real origin, which it takes from the browser, never from the page.

/** A passkey as it's kept inside a login item. */
export type StoredPasskey = {
	/** base64url, 16 random bytes. */
	credentialId: string;
	rpId: string;
	rpName?: string;
	/** base64url, as the site gave it. */
	userHandle: string;
	userName?: string;
	userDisplayName?: string;
	/** PKCS#8 of an ES256 (P-256) key, base64url. */
	privateKey: string;
	createdAt: string;
};

/** What `navigator.credentials.create` asked for, with its bytes as base64url. */
export type CreateRequest = {
	challenge: string;
	rp: { id?: string; name?: string };
	user: { id: string; name?: string; displayName?: string };
	pubKeyCredParams: { type: string; alg: number }[];
	excludeCredentials?: { id: string; type?: string }[];
	authenticatorSelection?: {
		authenticatorAttachment?: string;
		residentKey?: string;
		requireResidentKey?: boolean;
		userVerification?: string;
	};
	attestation?: string;
	extensions?: Record<string, unknown>;
};

/** What `navigator.credentials.get` asked for, with its bytes as base64url. */
export type GetRequest = {
	challenge: string;
	rpId?: string;
	allowCredentials?: { id: string; type?: string }[];
	userVerification?: string;
	extensions?: Record<string, unknown>;
};

/** A credential in WebAuthn's JSON encoding, which the page script turns into objects. */
export type CreatedCredential = {
	id: string;
	rawId: string;
	type: "public-key";
	authenticatorAttachment: "platform";
	response: {
		clientDataJSON: string;
		attestationObject: string;
		authenticatorData: string;
		publicKey: string;
		publicKeyAlgorithm: number;
		transports: string[];
	};
	clientExtensionResults: Record<string, unknown>;
};

export type Assertion = {
	id: string;
	rawId: string;
	type: "public-key";
	authenticatorAttachment: "platform";
	response: {
		clientDataJSON: string;
		authenticatorData: string;
		signature: string;
		userHandle: string;
	};
	clientExtensionResults: Record<string, unknown>;
};

const ES256 = -7;
const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
// User present, user verified (the vault is unlocked and a person chose), backup eligible
// and backed up (it's in a synced vault), attested credential data included.
const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;
const AT = 0x40;
const AAGUID = new Uint8Array(16);

// ── Encodings ──────────────────────────────────────────────────────────────────────

const utf8 = new TextEncoder();

function concat(...parts: Uint8Array[]) {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

/** CBOR (RFC 8949), only as much as authenticator data and attestation objects need. */
export function cbor(value: Cbor): Uint8Array {
	const head = (major: number, n: number) => {
		if (n < 24) return Uint8Array.of((major << 5) | n);
		if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
		if (n < 0x10000) return Uint8Array.of((major << 5) | 25, n >> 8, n & 0xff);
		return Uint8Array.of(
			(major << 5) | 26,
			(n >>> 24) & 0xff,
			(n >>> 16) & 0xff,
			(n >>> 8) & 0xff,
			n & 0xff,
		);
	};
	if (typeof value === "number") {
		return value >= 0 ? head(0, value) : head(1, -1 - value);
	}
	if (typeof value === "string") {
		const bytes = utf8.encode(value);
		return concat(head(3, bytes.length), bytes);
	}
	if (value instanceof Uint8Array) return concat(head(2, value.length), value);
	return concat(
		head(5, value.size),
		...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)]),
	);
}

/** WebCrypto signs ECDSA as r‖s; WebAuthn wants the ASN.1 DER that X.509 uses. */
export function derSignature(raw: Uint8Array) {
	const integer = (bytes: Uint8Array) => {
		let start = 0;
		while (start < bytes.length - 1 && bytes[start] === 0) start++;
		let body = bytes.slice(start);
		if ((body[0] ?? 0) & 0x80) body = concat(Uint8Array.of(0), body);
		return concat(Uint8Array.of(0x02, body.length), body);
	};
	const half = raw.length / 2;
	const body = concat(integer(raw.slice(0, half)), integer(raw.slice(half)));
	return concat(Uint8Array.of(0x30, body.length), body);
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

// ── What the page sent ─────────────────────────────────────────────────────────────

// The page's script turns the options into JSON; the page can send anything, so nothing
// is used before it's checked here.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isBytes = (value: unknown, max: number): value is string =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= max &&
	/^[A-Za-z0-9_-]+$/.test(value);
const optionalText = (value: unknown) =>
	value === undefined || typeof value === "string";
/** Hosts are compared as the browser writes them: lowercase. */
const host = (value: unknown) =>
	typeof value === "string" && value.length <= 253
		? value.toLowerCase()
		: undefined;

function readCredentialList(value: unknown) {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 64) return null;
	const list = value.filter(
		(entry): entry is { id: string; type?: string } =>
			isObject(entry) && isBytes(entry.id, 1366),
	);
	return list.length === value.length
		? list.map(({ id, type }) => ({ id, type }))
		: null;
}

const extensionNames = (value: unknown) =>
	isObject(value)
		? Object.fromEntries(Object.keys(value).map((name) => [name, true]))
		: undefined;

export function readCreateRequest(raw: unknown): CreateRequest | null {
	if (!isObject(raw) || !isObject(raw.rp) || !isObject(raw.user)) return null;
	const { rp, user } = raw;
	// A user handle is at most 64 bytes.
	if (!isBytes(raw.challenge, 1366) || !isBytes(user.id, 86)) return null;
	if (rp.id !== undefined && !host(rp.id)) return null;
	if (![rp.name, user.name, user.displayName].every(optionalText)) return null;
	if (!Array.isArray(raw.pubKeyCredParams)) return null;
	const excluded = readCredentialList(raw.excludeCredentials);
	if (!excluded) return null;
	const selection = isObject(raw.authenticatorSelection)
		? raw.authenticatorSelection
		: {};
	return {
		challenge: raw.challenge,
		rp: {
			...(rp.id !== undefined && { id: host(rp.id) }),
			...(typeof rp.name === "string" && { name: rp.name.slice(0, 200) }),
		},
		user: {
			id: user.id,
			...(typeof user.name === "string" && { name: user.name.slice(0, 200) }),
			...(typeof user.displayName === "string" && {
				displayName: user.displayName.slice(0, 200),
			}),
		},
		pubKeyCredParams: raw.pubKeyCredParams
			.filter(isObject)
			.map((param) => ({ type: String(param.type), alg: Number(param.alg) })),
		excludeCredentials: excluded,
		authenticatorSelection: {
			...(typeof selection.authenticatorAttachment === "string" && {
				authenticatorAttachment: selection.authenticatorAttachment,
			}),
		},
		extensions: extensionNames(raw.extensions),
	};
}

export function readGetRequest(raw: unknown): GetRequest | null {
	if (!isObject(raw) || !isBytes(raw.challenge, 1366)) return null;
	if (raw.rpId !== undefined && !host(raw.rpId)) return null;
	const allowed = readCredentialList(raw.allowCredentials);
	if (!allowed) return null;
	return {
		challenge: raw.challenge,
		...(raw.rpId !== undefined && { rpId: host(raw.rpId) }),
		allowCredentials: allowed,
		extensions: extensionNames(raw.extensions),
	};
}

/** A passkey read back from an item, or null when the item has none, or a broken one. */
export function readPasskey(value: unknown): StoredPasskey | null {
	if (!isObject(value)) return null;
	const { credentialId, rpId, userHandle, privateKey, createdAt } = value;
	if (
		!isBytes(credentialId, 1366) ||
		typeof rpId !== "string" ||
		!isBytes(userHandle, 86) ||
		!isBytes(privateKey, 4096) ||
		typeof createdAt !== "string"
	)
		return null;
	return value as StoredPasskey;
}

// ── Who may ask ────────────────────────────────────────────────────────────────────

/**
 * Why a page at `origin` can't use passkeys for `rpId`, or null when it can. The page
 * must be HTTPS (or localhost), and the rpId its own host or a parent of it, but never a
 * public suffix such as "com" or "github.io": otherwise one customer's site on a shared
 * host could sign in to another's.
 */
export function rpProblem(origin: string, rpId: string): string | null {
	let url: URL;
	try {
		url = new URL(origin);
	} catch {
		return "The page has no address vauly can check.";
	}
	const host = url.hostname;
	const local = host === "localhost";
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		return "Passkeys need a secure (HTTPS) page.";
	}
	if (rpId !== host && !host.endsWith(`.${rpId}`)) {
		return `${host} can't use passkeys for ${rpId}.`;
	}
	if (local) return rpId === "localhost" ? null : "Not a site's own domain.";
	const parsed = parse(rpId, { allowPrivateDomains: true });
	if (parsed.isIp) return "Not a site's own domain.";
	// No registrable domain means rpId is itself a public suffix.
	if (!parsed.domain) {
		return `${rpId} is shared by many sites, so no passkey can belong to it.`;
	}
	return null;
}

function clientData(
	type: "webauthn.create" | "webauthn.get",
	challenge: string,
	origin: string,
) {
	return utf8.encode(
		JSON.stringify({ type, challenge, origin, crossOrigin: false }),
	);
}

// ── Creating and using a passkey ───────────────────────────────────────────────────

/**
 * Whether vauly can make the passkey a site asks for, rather than handing it to the
 * browser: an ES256 key, not one on a security key, and nothing vauly can't keep, such as
 * a PRF secret or a large blob.
 */
export function canCreate(request: CreateRequest) {
	const selection = request.authenticatorSelection ?? {};
	const extensions = Object.keys(request.extensions ?? {});
	return (
		request.pubKeyCredParams.some(
			(param) => param.type === "public-key" && param.alg === ES256,
		) &&
		selection.authenticatorAttachment !== "cross-platform" &&
		!extensions.some((name) =>
			["prf", "largeBlob", "hmacCreateSecret"].includes(name),
		)
	);
}

export async function createPasskey(
	request: CreateRequest,
	origin: string,
	now = new Date(),
): Promise<{ passkey: StoredPasskey; credential: CreatedCredential }> {
	const rpId = request.rp.id ?? new URL(origin).hostname;
	const keys = await crypto.subtle.generateKey(P256, true, ["sign", "verify"]);
	const credentialId = crypto.getRandomValues(new Uint8Array(16));
	const raw = new Uint8Array(
		await crypto.subtle.exportKey("raw", keys.publicKey),
	);
	const coseKey = cbor(
		new Map<number, Cbor>([
			[1, 2], // EC2
			[3, ES256],
			[-1, 1], // P-256
			[-2, raw.slice(1, 33)],
			[-3, raw.slice(33, 65)],
		]),
	);
	const authenticatorData = concat(
		await sha256(utf8.encode(rpId)),
		Uint8Array.of(UP | UV | BE | BS | AT),
		new Uint8Array(4),
		AAGUID,
		Uint8Array.of(credentialId.length >> 8, credentialId.length & 0xff),
		credentialId,
		coseKey,
	);
	const attestationObject = cbor(
		new Map<string, Cbor>([
			["fmt", "none"],
			["attStmt", new Map()],
			["authData", authenticatorData],
		]),
	);
	const id = toBase64Url(credentialId);
	const spki = new Uint8Array(
		await crypto.subtle.exportKey("spki", keys.publicKey),
	);
	const pkcs8 = new Uint8Array(
		await crypto.subtle.exportKey("pkcs8", keys.privateKey),
	);
	return {
		passkey: {
			credentialId: id,
			rpId,
			...(request.rp.name && { rpName: request.rp.name }),
			userHandle: request.user.id,
			...(request.user.name && { userName: request.user.name }),
			...(request.user.displayName && {
				userDisplayName: request.user.displayName,
			}),
			privateKey: toBase64Url(pkcs8),
			createdAt: now.toISOString(),
		},
		credential: {
			id,
			rawId: id,
			type: "public-key",
			authenticatorAttachment: "platform",
			response: {
				clientDataJSON: toBase64Url(
					clientData("webauthn.create", request.challenge, origin),
				),
				attestationObject: toBase64Url(attestationObject),
				authenticatorData: toBase64Url(authenticatorData),
				publicKey: toBase64Url(spki),
				publicKeyAlgorithm: ES256,
				transports: ["hybrid", "internal"],
			},
			clientExtensionResults:
				request.extensions && "credProps" in request.extensions
					? { credProps: { rk: true } }
					: {},
		},
	};
}

/** The passkeys a sign-in request can use: for its rpId, and in its allow list if it has one. */
export function usable(
	passkeys: StoredPasskey[],
	request: GetRequest,
	rpId: string,
) {
	const allowed = request.allowCredentials?.map((credential) => credential.id);
	return passkeys.filter(
		(passkey) =>
			passkey.rpId === rpId &&
			(!allowed?.length || allowed.includes(passkey.credentialId)),
	);
}

export async function signIn(
	passkey: StoredPasskey,
	request: GetRequest,
	origin: string,
): Promise<Assertion> {
	const authenticatorData = concat(
		await sha256(utf8.encode(passkey.rpId)),
		Uint8Array.of(UP | UV | BE | BS),
		// Synced passkeys keep a counter of 0, so a shared one never needs writing back.
		new Uint8Array(4),
	);
	const data = clientData("webauthn.get", request.challenge, origin);
	const key = await crypto.subtle.importKey(
		"pkcs8",
		fromBase64Url(passkey.privateKey),
		P256,
		false,
		["sign"],
	);
	const signature = new Uint8Array(
		await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			key,
			concat(authenticatorData, await sha256(data)),
		),
	);
	return {
		id: passkey.credentialId,
		rawId: passkey.credentialId,
		type: "public-key",
		authenticatorAttachment: "platform",
		response: {
			clientDataJSON: toBase64Url(data),
			authenticatorData: toBase64Url(authenticatorData),
			signature: toBase64Url(derSignature(signature)),
			userHandle: passkey.userHandle,
		},
		clientExtensionResults: {},
	};
}
