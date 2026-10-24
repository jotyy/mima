import sodium from "libsodium-wrappers-sumo";

import type { Argon2 } from "./index";

// Argon2id from libsodium, through its WebAssembly build (libsodium.js). libsodium's
// independent assessment covered its password hashing, Argon2id included, and its
// Argon2 is the reference code. Every vauly app derives with this: the web app inside its
// key worker, whose CSP allows WebAssembly when the page's doesn't; the extension and the
// tests directly. The package is pinned to one exact version.

export const argon2id: Argon2 = async (password, salt, passes, memory) => {
	await sodium.ready;
	return sodium.crypto_pwhash(
		32,
		password,
		salt,
		passes,
		memory * 1024,
		sodium.crypto_pwhash_ALG_ARGON2ID13,
	);
};

/**
 * Why Argon2id failed, for a message the person can act on: the device ran out of memory,
 * something (usually a policy) stopped the WebAssembly from compiling, or something else.
 */
export function argon2Failure(error: unknown): "memory" | "blocked" | "failed" {
	const message = error instanceof Error ? error.message : String(error);
	if (/CompileError|WebAssembly|wasm/i.test(message)) return "blocked";
	// hash-wasm doesn't check that its memory grew: running out shows up later, as a
	// RangeError ("Invalid typed array length" in V8, "Length out of range of buffer" in
	// JavaScriptCore).
	if (
		(error instanceof Error && error.name === "RangeError") ||
		/invalid usage|memory|enlarge|RangeError|out of range|typed array length/i.test(
			message,
		)
	)
		return "memory";
	return "failed";
}
