import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
	type AccountKeys,
	changeMasterPassword,
	createAccount,
	decodeAgentToken,
	deriveMasterKeys,
	encodeAgentToken,
	fromBase64,
	importPrivateKey,
	keyFromText,
	keyToText,
	open,
	openJson,
	parseTotp,
	seal,
	sealJson,
	sha256Hex,
	type TotpConfig,
	toBase64,
	totpCode,
	unlockAccount,
	unwrapKey,
	unwrapKeyFrom,
	wrapKey,
	wrapKeyFor,
} from "./index";
import { withFixedRandom } from "./random";

// Checks packages/crypto against test-vectors.json, which scripts/vectors.ts computes from
// the formats on their own. If this fails, the package no longer makes what other
// implementations (and existing vaults) expect: fix the package, or, for a deliberate
// format change, regenerate the vectors and plan how existing data moves over.

type Vectors = {
	masterKeys: {
		password: string;
		salt: string;
		iterations: number;
		authKey: string;
		wrapKeyCheck: { iv: string; plaintext: string; sealed: string };
	}[];
	seal: { key: string; iv: string; plaintext: string; sealed: string }[];
	sealJson: { key: string; iv: string; value: unknown; sealed: string }[];
	wrapKey: { wrappingKey: string; key: string; iv: string; wrapped: string }[];
	wrapKeyFor: {
		recipientPrivateKey: string;
		recipientPublicKey: string;
		ephemeralPrivateKey: string;
		key: string;
		iv: string;
		wrapped: string;
	}[];
	linkKey: { key: string; text: string }[];
	createAccount: {
		password: string;
		iterations: number;
		salt: string;
		privateKey: string;
		iv: string;
		authKey: string;
		keys: AccountKeys;
	}[];
	changeMasterPassword: {
		current: string;
		next: string;
		keys: AccountKeys;
		iterations: number;
		salt: string;
		iv: string;
		currentAuthKey: string;
		authKey: string;
		nextKeys: AccountKeys;
	}[];
	agentToken: {
		agentId: string;
		secret: string;
		privateKey: string;
		token: string;
		secretHash: string;
	}[];
	totp: (TotpConfig & { time: number; code: string })[];
	parseTotp: { input: string; config: TotpConfig }[];
};

const vectors: Vectors = JSON.parse(
	readFileSync(new URL("../test-vectors.json", import.meta.url), "utf8"),
);
const encoder = new TextEncoder();

const aesKey = (base64: string) =>
	crypto.subtle.importKey("raw", fromBase64(base64), "AES-GCM", true, [
		"encrypt",
		"decrypt",
	]);

const exportRaw = async (key: CryptoKey) =>
	toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));

/** A key pair from its PKCS#8 private key, the way generateKey would hand it over. */
async function keyPair(pkcs8: string): Promise<CryptoKeyPair> {
	const ecdh = { name: "ECDH", namedCurve: "P-256" };
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		fromBase64(pkcs8),
		ecdh,
		true,
		["deriveBits"],
	);
	const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", privateKey);
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{ kty, crv, x, y },
		ecdh,
		true,
		[],
	);
	return { privateKey, publicKey };
}

describe("master keys", () => {
	for (const vector of vectors.masterKeys) {
		test(`${vector.iterations} rounds of "${vector.password}"`, async () => {
			const keys = await deriveMasterKeys(
				vector.password,
				vector.salt,
				vector.iterations,
			);
			expect(keys.authKey).toBe(vector.authKey);
			const { iv, plaintext, sealed } = vector.wrapKeyCheck;
			const made = await withFixedRandom({ bytes: [fromBase64(iv)] }, () =>
				seal(keys.wrapKey, encoder.encode(plaintext)),
			);
			expect(made).toBe(sealed);
		});
	}
});

describe("sealed values", () => {
	test("seal and open", async () => {
		for (const vector of vectors.seal) {
			const key = await aesKey(vector.key);
			const made = await withFixedRandom(
				{ bytes: [fromBase64(vector.iv)] },
				() => seal(key, encoder.encode(vector.plaintext)),
			);
			expect(made).toBe(vector.sealed);
			const opened = await open(key, vector.sealed);
			expect(new TextDecoder().decode(opened)).toBe(vector.plaintext);
		}
	});

	test("sealJson and openJson", async () => {
		for (const vector of vectors.sealJson) {
			const key = await aesKey(vector.key);
			const made = await withFixedRandom(
				{ bytes: [fromBase64(vector.iv)] },
				() => sealJson(key, vector.value),
			);
			expect(made).toBe(vector.sealed);
			expect(await openJson(key, vector.sealed)).toEqual(vector.value);
		}
	});
});

describe("key wrapping", () => {
	test("wrapKey and unwrapKey", async () => {
		for (const vector of vectors.wrapKey) {
			const wrapping = await aesKey(vector.wrappingKey);
			const key = await aesKey(vector.key);
			const made = await withFixedRandom(
				{ bytes: [fromBase64(vector.iv)] },
				() => wrapKey(wrapping, key),
			);
			expect(made).toBe(vector.wrapped);
			expect(await exportRaw(await unwrapKey(wrapping, vector.wrapped))).toBe(
				vector.key,
			);
		}
	});

	test("wrapKeyFor and unwrapKeyFrom", async () => {
		for (const vector of vectors.wrapKeyFor) {
			const key = await aesKey(vector.key);
			const made = await withFixedRandom(
				{
					ecdhKeyPairs: [await keyPair(vector.ephemeralPrivateKey)],
					bytes: [fromBase64(vector.iv)],
				},
				() => wrapKeyFor(vector.recipientPublicKey, key),
			);
			expect(made).toBe(vector.wrapped);
			const recipient = await importPrivateKey(
				fromBase64(vector.recipientPrivateKey),
			);
			const opened = await unwrapKeyFrom(
				recipient,
				vector.recipientPublicKey,
				vector.wrapped,
			);
			expect(await exportRaw(opened)).toBe(vector.key);
		}
	});

	test("share link keys", async () => {
		const [sealed] = vectors.seal;
		for (const vector of vectors.linkKey) {
			expect(await keyToText(await aesKey(vector.key))).toBe(vector.text);
			const key = await keyFromText(vector.text);
			if (sealed) expect(await open(key, sealed.sealed)).toBeDefined();
		}
	});
});

describe("accounts", () => {
	test("createAccount, then unlockAccount", async () => {
		for (const vector of vectors.createAccount) {
			const made = await withFixedRandom(
				{
					bytes: [fromBase64(vector.salt), fromBase64(vector.iv)],
					ecdhKeyPairs: [await keyPair(vector.privateKey)],
				},
				() => createAccount(vector.password, vector.iterations),
			);
			expect(made.authKey).toBe(vector.authKey);
			expect(made.keys).toEqual(vector.keys);

			const unlocked = await unlockAccount(vector.password, vector.keys);
			expect(unlocked.authKey).toBe(vector.authKey);
			const pkcs8 = await crypto.subtle.exportKey("pkcs8", unlocked.privateKey);
			expect(toBase64(new Uint8Array(pkcs8))).toBe(vector.privateKey);
		}
	});

	test("changeMasterPassword", async () => {
		for (const vector of vectors.changeMasterPassword) {
			const made = await withFixedRandom(
				{ bytes: [fromBase64(vector.salt), fromBase64(vector.iv)] },
				() =>
					changeMasterPassword(
						vector.current,
						vector.next,
						vector.keys,
						vector.iterations,
					),
			);
			expect(made.currentAuthKey).toBe(vector.currentAuthKey);
			expect(made.authKey).toBe(vector.authKey);
			expect(made.keys).toEqual(vector.nextKeys);
			expect((await unlockAccount(vector.next, vector.nextKeys)).authKey).toBe(
				vector.authKey,
			);
			await expect(
				unlockAccount(vector.current, vector.nextKeys),
			).rejects.toThrow();
		}
	});
});

test("agent tokens", async () => {
	for (const vector of vectors.agentToken) {
		const privateKey = fromBase64(vector.privateKey);
		expect(encodeAgentToken(vector.agentId, vector.secret, privateKey)).toBe(
			vector.token,
		);
		const decoded = decodeAgentToken(vector.token);
		expect(decoded.agentId).toBe(vector.agentId);
		expect(decoded.secret).toBe(vector.secret);
		expect(toBase64(decoded.privateKeyRaw)).toBe(vector.privateKey);
		expect(await sha256Hex(vector.secret)).toBe(vector.secretHash);
	}
});

test("one-time codes: RFC 6238", async () => {
	for (const { time, code, ...config } of vectors.totp) {
		expect(await totpCode(config, time * 1000)).toBe(code);
	}
});

test("parseTotp", () => {
	for (const vector of vectors.parseTotp) {
		expect(parseTotp(vector.input)).toEqual(vector.config);
	}
});

test("fixed randomness has to be used up, in the lengths asked for", async () => {
	const key = await aesKey(vectors.seal[0]?.key ?? "");
	await expect(
		withFixedRandom({ bytes: [new Uint8Array(16)] }, () =>
			seal(key, new Uint8Array()),
		),
	).rejects.toThrow("12 fixed random bytes");
	await expect(
		withFixedRandom({ bytes: [new Uint8Array(12), new Uint8Array(12)] }, () =>
			seal(key, new Uint8Array()),
		),
	).rejects.toThrow("left unused");
	// And afterwards, sealing is random again.
	const plaintext = new Uint8Array([1]);
	expect(await seal(key, plaintext)).not.toBe(await seal(key, plaintext));
});
