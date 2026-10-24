import type { Argon2 } from "@vauly/crypto";
import type { Argon2Request, Argon2Response } from "./argon2.worker";
import type { Argon2Lanes } from "./import/protected";

// Argon2id runs in a key worker (argon2.worker.ts). One waits ready, its files loaded and
// 4 MiB in use, so an unlock works even when they can't be fetched: offline, without a
// service worker. Each derivation takes it and ends it once it answers, which frees the
// 64 MiB it used, and a fresh one takes its place.

/** Why the key couldn't be derived on this device, in words the person can act on. */
export class KeyDerivationError extends Error {
	constructor(
		readonly reason: keyof typeof failures,
		message = failures[reason],
	) {
		super(message);
	}
}

const failures = {
	memory:
		"This device ran out of memory while deriving your key. Close some other tabs or apps, then try again.",
	blocked:
		"This browser stopped the code that derives your key from running. A browser extension or a network filter may be changing vauly's security settings.",
	load: "vauly couldn't load the code that derives your key. Reload the page: if vauly was just updated, that gets the new version.",
	timeout:
		"Deriving your key took too long on this device. Reload the page, then try again.",
	failed:
		"vauly couldn't derive your key on this device. Reload the page, then try again.",
};

/** Far longer than a slow phone takes (about a second), so only a stuck worker hits it. */
const TIMEOUT_MS = 60_000;

type KeyWorker = { worker: Worker; failed: boolean };

let ready: KeyWorker | null = null;

function startKeyWorker(): KeyWorker {
	const worker = new Worker(new URL("./argon2.worker.ts", import.meta.url), {
		type: "module",
		name: "argon2",
	});
	const started: KeyWorker = { worker, failed: false };
	worker.addEventListener(
		"error",
		() => {
			started.failed = true;
		},
		{ once: true },
	);
	return started;
}

/** Starts the waiting key worker, if there isn't one. */
export function prepareArgon2() {
	if (!ready || ready.failed) ready = startKeyWorker();
}

/** Runs one derivation in the waiting key worker, then ends it. */
function inKeyWorker(request: Argon2Request) {
	return new Promise<Uint8Array>((resolve, reject) => {
		const { worker } = ready && !ready.failed ? ready : startKeyWorker();
		ready = null;
		const done = () => {
			clearTimeout(timer);
			worker.terminate();
			prepareArgon2();
		};
		const fail = (reason: keyof typeof failures) => {
			done();
			reject(new KeyDerivationError(reason));
		};
		const timer = setTimeout(() => fail("timeout"), TIMEOUT_MS);
		worker.onmessage = ({ data }: MessageEvent<Argon2Response>) => {
			if ("bits" in data) {
				done();
				resolve(data.bits);
			} else fail(data.failure);
		};
		worker.onerror = () => fail("load");
		worker.postMessage(request);
	});
}

export const argon2InWorker: Argon2 = (password, salt, passes, memory) =>
	inKeyWorker({ password, salt, passes, memory });

/** For another app's file, such as a Bitwarden export: Argon2id with lanes. */
export const argon2LanesInWorker: Argon2Lanes = (
	password,
	salt,
	passes,
	memory,
	lanes,
) => inKeyWorker({ password, salt, passes, memory, lanes });
