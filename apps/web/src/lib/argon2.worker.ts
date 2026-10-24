import { argon2Failure, argon2id } from "@vauly/crypto/argon2";
import { argon2idLanes } from "@vauly/crypto/argon2-lanes";

// The key worker: Argon2id runs here and nowhere else in the app, because it's WebAssembly
// and the page's CSP doesn't let WebAssembly compile. This worker's files are served with
// a CSP of their own that does, and that has no connect-src, so nothing in it can send
// anything anywhere (security-headers.ts). The page starts one for each derivation and
// ends it afterwards, which frees the 64 MiB it uses. vauly's own keys come from
// libsodium; a Bitwarden file asks for lanes, which only hash-wasm has.

export type Argon2Request = {
	password: Uint8Array;
	salt: Uint8Array;
	passes: number;
	/** In KiB. */
	memory: number;
	/** Only for another app's file: Argon2id with this many lanes, from hash-wasm. */
	lanes?: number;
};
export type Argon2Response =
	| { bits: Uint8Array }
	| { failure: ReturnType<typeof argon2Failure> };

self.onmessage = async ({ data }: MessageEvent<Argon2Request>) => {
	let response: Argon2Response;
	try {
		response = {
			bits: data.lanes
				? await argon2idLanes(
						data.password,
						data.salt,
						data.passes,
						data.memory,
						data.lanes,
					)
				: await argon2id(data.password, data.salt, data.passes, data.memory),
		};
	} catch (error) {
		response = { failure: argon2Failure(error) };
	}
	self.postMessage(response);
};
