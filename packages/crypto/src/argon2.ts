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
