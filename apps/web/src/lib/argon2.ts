import type { Argon2 } from "@vauly/crypto";

import type { Argon2Request, Argon2Response } from "./argon2.worker";

// Argon2id runs in a key worker (argon2.worker.ts). One waits ready, its files loaded and
// 4 MiB in use, so an unlock works even when they can't be fetched: offline, without a
// service worker. Each derivation takes it and ends it once it answers, which frees the
// 64 MiB it used, and a fresh one takes its place.

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

export const argon2InWorker: Argon2 = (password, salt, passes, memory) =>
	new Promise((resolve, reject) => {
		const { worker } = ready && !ready.failed ? ready : startKeyWorker();
		ready = null;
		const done = () => {
			worker.terminate();
			prepareArgon2();
		};
		worker.onmessage = ({ data }: MessageEvent<Argon2Response>) => {
			done();
			if ("bits" in data) resolve(data.bits);
			else reject(new Error(data.error));
		};
		worker.onerror = (event) => {
			done();
			reject(new Error(event.message || "The key worker didn't start"));
		};
		worker.postMessage({
			password,
			salt,
			passes,
			memory,
		} satisfies Argon2Request);
	});
