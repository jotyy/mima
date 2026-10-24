import { argon2id } from "hash-wasm";

// Argon2id with any number of lanes, for files other apps encrypt: Bitwarden's
// password-protected exports default to four, and libsodium's Argon2id (./argon2.ts),
// which vauly derives its own keys with, has only one. This is hash-wasm, pinned to one
// exact version. The web app runs it in its key worker, like libsodium, and only for a
// Bitwarden file; vauly's own keys never come from it.

/** 32 bytes of Argon2id v1.3, with `memory` in KiB, as ./argon2.ts takes it, and `lanes` its parallelism. */
export async function argon2idLanes(
	password: Uint8Array,
	salt: Uint8Array,
	passes: number,
	memory: number,
	lanes: number,
) {
	return argon2id({
		password,
		salt,
		iterations: passes,
		memorySize: memory,
		parallelism: lanes,
		hashLength: 32,
		outputType: "binary",
	});
}
