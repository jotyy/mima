import { type KdbxAttachment, KdbxOpenError, openKdbx } from "./kdbx-open";

// The import worker: a KeePass database opens here, because its key derivation (Argon2)
// is WebAssembly, which the page's CSP doesn't let compile. Built into the key worker's
// folder, it gets that worker's CSP, which lets WebAssembly compile and has no
// connect-src, so nothing here can send anything anywhere (security-headers.ts). The
// page starts one for each database and ends it when it answers.

export type KdbxRequest = {
	file: ArrayBuffer;
	password: string;
	keyFile?: ArrayBuffer;
	/** The largest file the instance takes: bigger attachments come without their bytes. */
	fileLimit?: number;
};
export type KdbxResponse =
	| { xml: string; files: KdbxAttachment[] }
	| { failure: KdbxOpenError["reason"]; message: string };

self.onmessage = async ({ data }: MessageEvent<KdbxRequest>) => {
	let response: KdbxResponse;
	try {
		response = await openKdbx(
			data.file,
			data.password,
			data.keyFile,
			data.fileLimit,
		);
	} catch (error) {
		response =
			error instanceof KdbxOpenError
				? { failure: error.reason, message: error.message }
				: {
						failure: "corrupt",
						message:
							"That database couldn't be read. It may be damaged; export it to XML instead.",
					};
	}
	// The attachments' bytes are moved to the page, not copied.
	self.postMessage(
		response,
		"files" in response
			? response.files.flatMap((file) => (file.data ? [file.data] : []))
			: [],
	);
};
