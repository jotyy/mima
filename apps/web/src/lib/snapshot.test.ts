/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { createAccount } from "@vauly/crypto";

import { type Contents, isFresh, openSnapshot, sealSnapshot } from "./snapshot";

// Made-up rows in the API's shape; only their round trip and their secrecy matter here.
const contents = {
	profile: {
		id: "user_alex",
		name: "Alex Kim",
		email: "alex@acme.test",
		role: "owner",
		twoStep: false,
		recoveryCodesLeft: 0,
	},
	vaults: [{ id: "vault_private", encryptedMeta: "sealed-meta" }],
	items: [{ id: "item_github", vaultId: "vault_private", data: "sealed-item" }],
} as unknown as Contents;

describe("the offline copy", () => {
	test("opens with the account's private key, as it was", async () => {
		const account = await createAccount("correct horse battery staple", 1_000);
		const snapshot = await sealSnapshot(
			{ id: "user_alex", sessionId: "session_1", keys: account.keys },
			contents,
		);
		expect(await openSnapshot(snapshot, account.privateKey)).toEqual(contents);
	});

	test("keeps nothing readable but what unlocking needs", async () => {
		const account = await createAccount("correct horse battery staple", 1_000);
		const snapshot = await sealSnapshot(
			{ id: "user_alex", sessionId: "session_1", keys: account.keys },
			contents,
		);
		const stored = JSON.stringify(snapshot);
		for (const secret of [
			"alex@acme.test",
			"Alex Kim",
			"vault_private",
			"item_github",
			"sealed-item",
		]) {
			expect(stored).not.toContain(secret);
		}
		expect(Object.keys(snapshot).sort()).toEqual([
			"accountId",
			"cacheKey",
			"keys",
			"sealed",
			"sessionId",
			"syncedAt",
		]);
	});

	test("another account's key doesn't open it", async () => {
		const alex = await createAccount("correct horse battery staple", 1_000);
		const sam = await createAccount("another long passphrase", 1_000);
		const snapshot = await sealSnapshot(
			{ id: "user_alex", sessionId: "session_1", keys: alex.keys },
			contents,
		);
		await expect(openSnapshot(snapshot, sam.privateKey)).rejects.toThrow();
	});

	test("is used for 30 days at most", async () => {
		const account = await createAccount("correct horse battery staple", 1_000);
		const day = 24 * 60 * 60_000;
		const now = Date.now();
		const at = async (syncedAt: number) =>
			isFresh(
				await sealSnapshot(
					{ id: "user_alex", sessionId: "session_1", keys: account.keys },
					contents,
					syncedAt,
				),
				now,
			);
		expect(await at(now - 29 * day)).toBe(true);
		expect(await at(now - 31 * day)).toBe(false);
		expect(await at(now + day)).toBe(false);
	});
});
