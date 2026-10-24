import type { KdbxRequest, KdbxResponse } from "./kdbx.worker";
import { ImportError } from "./parsed";

// Opens a KeePass database in the import worker (kdbx.worker.ts), which hands it back as
// KeePass XML for the XML import to read. The worker gets the file, the password and the
// key file, and is ended when it answers, when it's cancelled, or when it takes too long.
// Only this runs on the page: kdbxweb and Argon2 load in the worker alone.

/** Why a database didn't open, in words the person can act on; `wrongKey` asks again. */
export class KdbxError extends ImportError {
	constructor(
		message: string,
		readonly wrongKey = false,
	) {
		super(message);
	}
}

/** Long enough for the slowest settings the import takes, on a slow laptop. */
const TIMEOUT_MS = 5 * 60 * 1000;

export function openKdbxInWorker(
	file: ArrayBuffer,
	password: string,
	keyFile?: ArrayBuffer,
	signal?: AbortSignal,
): Promise<{ xml: string; attachments: number }> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			return reject(new DOMException("Cancelled", "AbortError"));
		}
		const worker = new Worker(new URL("./kdbx.worker.ts", import.meta.url), {
			type: "module",
			name: "kdbx",
		});
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", cancel);
			worker.terminate();
		};
		const fail = (error: Error) => {
			done();
			reject(error);
		};
		const cancel = () => fail(new DOMException("Cancelled", "AbortError"));
		const timer = setTimeout(
			() =>
				fail(
					new KdbxError(
						"Opening the database took too long. Lower its key settings in KeePass, or export to XML.",
					),
				),
			TIMEOUT_MS,
		);
		signal?.addEventListener("abort", cancel, { once: true });
		worker.onmessage = ({ data }: MessageEvent<KdbxResponse>) => {
			if ("xml" in data) {
				done();
				resolve(data);
			} else {
				fail(new KdbxError(data.message, data.failure === "wrong-key"));
			}
		};
		worker.onerror = () =>
			fail(
				new KdbxError(
					"vauly couldn't start opening the database. Reload the page and try again.",
				),
			);
		// Moved, not copied: the caller hands over buffers of its own for each try.
		worker.postMessage(
			{ file, password, keyFile } satisfies KdbxRequest,
			keyFile ? [file, keyFile] : [file],
		);
	});
}
