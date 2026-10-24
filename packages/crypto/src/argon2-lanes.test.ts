import { describe, expect, test } from "bun:test";

import { argon2id } from "./argon2";
import { argon2idLanes } from "./argon2-lanes";

// Two implementations of one function: with a single lane, hash-wasm must give exactly
// what libsodium gives. Several lanes are checked against Bitwarden's own Argon2, in the
// web app's fixtures of its password-protected exports.

describe("argon2idLanes", () => {
	test("matches libsodium with one lane", async () => {
		const password = new TextEncoder().encode("correct horse battery staple");
		const salt = new Uint8Array(16).fill(7);
		const [ours, sodium] = await Promise.all([
			argon2idLanes(password, salt, 3, 16 * 1024, 1),
			argon2id(password, salt, 3, 16 * 1024),
		]);
		expect(Buffer.from(ours).toString("hex")).toBe(
			Buffer.from(sodium).toString("hex"),
		);
	});

	test("lanes change the key", async () => {
		const password = new TextEncoder().encode("correct horse battery staple");
		const salt = new Uint8Array(16).fill(7);
		const [one, four] = await Promise.all([
			argon2idLanes(password, salt, 3, 16 * 1024, 1),
			argon2idLanes(password, salt, 3, 16 * 1024, 4),
		]);
		expect(four).toHaveLength(32);
		expect(Buffer.from(four).toString("hex")).not.toBe(
			Buffer.from(one).toString("hex"),
		);
	});
});
