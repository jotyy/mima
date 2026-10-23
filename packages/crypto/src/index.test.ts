import { describe, expect, test } from "bun:test";

import {
	changeMasterPassword,
	createAccount,
	decodeAgentToken,
	deriveMasterKeys,
	encodeAgentToken,
	importPrivateKey,
	keyFromText,
	keyToText,
	newDataKey,
	newKeypair,
	newSalt,
	open,
	openJson,
	seal,
	sealJson,
	unlockAccount,
	unwrapKey,
	unwrapKeyFrom,
	wrapKey,
	wrapKeyFor,
} from "./index";

// Low iterations keep the suite fast; production uses KDF_ITERATIONS.
const FAST = 1_000;

describe("master password", () => {
	test("same password and salt give the same auth key", async () => {
		const salt = newSalt();
		const a = await deriveMasterKeys("correct horse", salt, FAST);
		const b = await deriveMasterKeys("correct horse", salt, FAST);
		expect(a.authKey).toBe(b.authKey);
		expect(a.authKey).toHaveLength(64);
	});

	test("the auth key does not reveal the password and changes with the salt", async () => {
		const a = await deriveMasterKeys("correct horse", newSalt(), FAST);
		const b = await deriveMasterKeys("correct horse", newSalt(), FAST);
		expect(a.authKey).not.toBe(b.authKey);
		expect(a.authKey).not.toContain("correct");
	});

	test("an account unlocks with its password and not with another", async () => {
		const { keys, authKey } = await createAccount("hunter2-example", FAST);
		const unlocked = await unlockAccount("hunter2-example", keys);
		expect(unlocked.authKey).toBe(authKey);
		await expect(unlockAccount("wrong", keys)).rejects.toThrow();
	});

	test("changing the master password keeps the key pair and drops the old password", async () => {
		const account = await createAccount("old-example-pass", FAST);
		const vaultKey = await newDataKey();
		const wrapped = await wrapKeyFor(account.keys.publicKey, vaultKey);

		const changed = await changeMasterPassword(
			"old-example-pass",
			"new-example-pass",
			account.keys,
			FAST,
		);
		expect(changed.currentAuthKey).toBe(account.authKey);
		expect(changed.authKey).not.toBe(account.authKey);
		expect(changed.keys.publicKey).toBe(account.keys.publicKey);
		expect(changed.keys.kdfSalt).not.toBe(account.keys.kdfSalt);

		// The new password opens the same private key, so shared vaults still open.
		const unlocked = await unlockAccount("new-example-pass", changed.keys);
		expect(unlocked.authKey).toBe(changed.authKey);
		const opened = await unwrapKeyFrom(
			unlocked.privateKey,
			changed.keys.publicKey,
			wrapped,
		);
		const sealed = await sealJson(vaultKey, { ok: true });
		expect(await openJson(opened, sealed)).toEqual({ ok: true });
		await expect(
			unlockAccount("old-example-pass", changed.keys),
		).rejects.toThrow();
		await expect(
			changeMasterPassword("wrong", "x", account.keys, FAST),
		).rejects.toThrow();
	});
});

describe("symmetric", () => {
	test("seal and open round-trip; tampering is detected", async () => {
		const key = await newDataKey();
		const sealed = await sealJson(key, { name: "GitHub", secret: "s3cret" });
		expect(sealed).not.toContain("GitHub");
		expect(await openJson(key, sealed)).toEqual({
			name: "GitHub",
			secret: "s3cret",
		});

		const [iv, body] = sealed.split(".");
		const flipped = `${iv}.${body?.startsWith("A") ? `B${body.slice(1)}` : `A${body?.slice(1)}`}`;
		await expect(open(key, flipped)).rejects.toThrow();
	});

	test("an item key wrapped with a vault key opens only with that vault key", async () => {
		const vaultKey = await newDataKey();
		const itemKey = await newDataKey();
		const wrapped = await wrapKey(vaultKey, itemKey);
		const unwrapped = await unwrapKey(vaultKey, wrapped);
		const sealed = await seal(itemKey, new TextEncoder().encode("value"));
		expect(new TextDecoder().decode(await open(unwrapped, sealed))).toBe(
			"value",
		);
		await expect(unwrapKey(await newDataKey(), wrapped)).rejects.toThrow();
	});
});

describe("share links", () => {
	test("a link key survives the trip through a URL fragment", async () => {
		const key = await newDataKey();
		const sealed = await sealJson(key, { name: "Office Wi-Fi" });
		const text = await keyToText(key);
		expect(text).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(await openJson(await keyFromText(text), sealed)).toEqual({
			name: "Office Wi-Fi",
		});
	});

	test("a cut-off key is refused", async () => {
		const text = await keyToText(await newDataKey());
		await expect(keyFromText(text.slice(0, 20))).rejects.toThrow();
	});
});

describe("sharing", () => {
	test("a vault key wrapped for a member opens with their private key only", async () => {
		const alice = await newKeypair();
		const mallory = await newKeypair();
		const vaultKey = await newDataKey();
		const wrapped = await wrapKeyFor(alice.publicKey, vaultKey);

		const opened = await unwrapKeyFrom(
			alice.privateKey,
			alice.publicKey,
			wrapped,
		);
		const sealed = await seal(vaultKey, new Uint8Array([1, 2, 3]));
		expect(Array.from(await open(opened, sealed))).toEqual([1, 2, 3]);
		await expect(
			unwrapKeyFrom(mallory.privateKey, mallory.publicKey, wrapped),
		).rejects.toThrow();
	});

	test("an agent token carries a private key that opens its grants", async () => {
		const agent = await newKeypair();
		const itemKey = await newDataKey();
		const grant = await wrapKeyFor(agent.publicKey, itemKey);

		const token = encodeAgentToken(
			"agent123",
			"secret456",
			agent.privateKeyRaw,
		);
		const decoded = decodeAgentToken(token);
		expect(decoded.agentId).toBe("agent123");
		expect(decoded.secret).toBe("secret456");
		const privateKey = await importPrivateKey(decoded.privateKeyRaw);
		const opened = await unwrapKeyFrom(privateKey, agent.publicKey, grant);
		const sealed = await sealJson(itemKey, { secret: "x" });
		expect(await openJson(opened, sealed)).toEqual({ secret: "x" });
	});

	test("malformed tokens are rejected", () => {
		expect(() => decodeAgentToken("mima_agent_only")).toThrow();
	});
});
