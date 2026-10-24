import { argon2Failure, argon2id } from "@vauly/crypto/argon2";

// The key worker: Argon2id runs here and nowhere else in the app, because it's WebAssembly
// and the page's CSP doesn't let WebAssembly compile. This worker's files are served with
// a CSP of their own that does, and that has no connect-src, so nothing in it can send
// anything anywhere (security-headers.ts). The page starts one for each derivation and
// ends it afterwards, which frees the 64 MiB it uses.

export type Argon2Request = {
	password: Uint8Array;
	salt: Uint8Array;
	passes: number;
	memory: number;
};
export type Argon2Response =
	| { bits: Uint8Array }
	| { failure: ReturnType<typeof argon2Failure> };

self.onmessage = async ({ data }: MessageEvent<Argon2Request>) => {
	let response: Argon2Response;
	try {
		response = {
			bits: await argon2id(data.password, data.salt, data.passes, data.memory),
		};
	} catch (error) {
		response = { failure: argon2Failure(error) };
	}
	self.postMessage(response);
};
