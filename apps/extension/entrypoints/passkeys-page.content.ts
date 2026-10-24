import { fromBase64Url, toBase64Url } from "@/lib/base64url";
import type { PasskeyCall, PasskeyOutcome, PasskeyReply } from "@/lib/messages";
import type { Assertion, CreatedCredential } from "@/lib/passkey";

// Runs in the page itself, before the site's own scripts, so a site asking the browser
// for a passkey asks vauly first. It holds nothing: it turns the request into JSON and
// posts it to vauly's content script, and turns the answer back into the objects the site
// expects. Whenever vauly doesn't answer, the browser's own passkeys do, with the site's
// options untouched.
export default defineContentScript({
	matches: ["https://*/*", "http://localhost/*"],
	runAt: "document_start",
	world: "MAIN",
	noScriptStartedPostMessage: true,
	main() {
		if (typeof PublicKeyCredential === "undefined" || !navigator.credentials)
			return;
		const container = CredentialsContainer.prototype;
		const nativeCreate = container.create;
		const nativeGet = container.get;

		container.create = function (options?: CredentialCreationOptions) {
			const native = () => nativeCreate.call(this, options);
			if (!options?.publicKey) return native();
			return viaVauly("create", options.publicKey, options.signal, native);
		};
		container.get = function (options?: CredentialRequestOptions) {
			const native = () => nativeGet.call(this, options);
			// Passkeys offered in the username field's suggestions come later.
			if (!options?.publicKey || options.mediation === "conditional")
				return native();
			return viaVauly("get", options.publicKey, options.signal, native);
		};

		// Sites only offer to make a passkey where they think one can be made, and vauly
		// can. The answer doesn't depend on whether vauly is signed in or unlocked.
		if (PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
			PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable =
				async () => true;
		}
	},
});

/** vauly's content script answers at once; without it, the browser takes over. */
const ACK_MS = 1000;
/** How long vauly's window waits for the person, within the site's own timeout. */
const TIMEOUT = { default: 5 * 60_000, min: 30_000, max: 10 * 60_000 };

function post(call: PasskeyCall) {
	window.postMessage(call, location.origin);
}

function listen(id: string, onReply: (reply: PasskeyReply) => void) {
	const handler = (event: MessageEvent) => {
		const data = event.data as PasskeyReply | undefined;
		if (event.source === window && data?.id === id) onReply(data);
	};
	window.addEventListener("message", handler);
	return () => window.removeEventListener("message", handler);
}

function viaVauly(
	kind: "create" | "get",
	options:
		| PublicKeyCredentialCreationOptions
		| PublicKeyCredentialRequestOptions,
	signal: AbortSignal | undefined,
	native: () => Promise<Credential | null>,
): Promise<Credential | null> {
	if (signal?.aborted) return native();
	let request: unknown;
	try {
		request = toJson(options);
	} catch {
		return native();
	}
	const id = crypto.randomUUID();
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (work: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			stop();
			signal?.removeEventListener("abort", aborted);
			work();
		};
		const toBrowser = () => settle(() => native().then(resolve, reject));
		const aborted = () => {
			post({ vauly: "passkey-abort", id });
			settle(() =>
				reject(
					signal?.reason ??
						new DOMException("The operation was aborted.", "AbortError"),
				),
			);
		};
		const timedOut = () => {
			post({ vauly: "passkey-abort", id });
			settle(() =>
				reject(
					new DOMException("The passkey request timed out.", "NotAllowedError"),
				),
			);
		};
		const answered = (outcome: PasskeyOutcome) => {
			if (outcome.next === "credential") {
				settle(() => resolve(credentialFrom(outcome.credential)));
			} else if (outcome.next === "error") {
				settle(() => reject(new DOMException(outcome.message, outcome.name)));
			} else if (outcome.next === "browser") {
				toBrowser();
			}
		};
		let timer = setTimeout(toBrowser, ACK_MS);
		const stop = listen(id, (reply) => {
			if (reply.vauly === "passkey-ack") {
				clearTimeout(timer);
				timer = setTimeout(timedOut, timeoutOf(options));
			}
			if (reply.vauly === "passkey-result") answered(reply.outcome);
		});
		signal?.addEventListener("abort", aborted);
		post({ vauly: "passkey", id, kind, request });
	});
}

/** The site's timeout, kept within reason; the browser clamps its own the same way. */
const timeoutOf = (options: { timeout?: number }) =>
	Math.min(
		TIMEOUT.max,
		Math.max(
			TIMEOUT.min,
			Number.isFinite(options.timeout)
				? Number(options.timeout)
				: TIMEOUT.default,
		),
	);

// ── The site's options as JSON, and the answer as objects ───────────────────────────

const isBuffer = (value: unknown): value is BufferSource =>
	value instanceof ArrayBuffer || ArrayBuffer.isView(value);

const bytesOf = (value: BufferSource) =>
	value instanceof ArrayBuffer
		? new Uint8Array(value)
		: new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

/** Bytes become base64url; extensions only say which ones the site asked for. */
function toJson(
	options:
		| PublicKeyCredentialCreationOptions
		| PublicKeyCredentialRequestOptions,
) {
	const convert = (value: unknown): unknown => {
		if (isBuffer(value)) return toBase64Url(bytesOf(value));
		if (Array.isArray(value)) return value.map(convert);
		if (value && typeof value === "object")
			return Object.fromEntries(
				Object.entries(value).map(([key, entry]) => [key, convert(entry)]),
			);
		return value;
	};
	const { extensions, ...rest } = options;
	return {
		...(convert(rest) as object),
		...(extensions && {
			extensions: Object.fromEntries(
				Object.keys(extensions).map((name) => [name, true]),
			),
		}),
	};
}

const buffer = (text: string) => fromBase64Url(text).buffer as ArrayBuffer;

/** Own properties, which take the place of the browser's getters on the prototype. */
const own = (entries: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(entries).map(([key, value]) => [
			key,
			{ value, enumerable: typeof value !== "function" },
		]),
	);

/**
 * Objects that pass for the browser's own: they inherit from PublicKeyCredential and the
 * response types, so `instanceof` checks and the JSON helpers sites use work as usual.
 */
function credentialFrom(json: CreatedCredential | Assertion): Credential {
	return Object.create(
		PublicKeyCredential.prototype,
		own({
			id: json.id,
			rawId: buffer(json.rawId),
			type: json.type,
			authenticatorAttachment: json.authenticatorAttachment,
			response:
				"attestationObject" in json.response
					? attestationResponse(json.response)
					: assertionResponse(json.response),
			getClientExtensionResults: () =>
				structuredClone(json.clientExtensionResults),
			toJSON: () => structuredClone(json),
		}),
	);
}

function attestationResponse(response: CreatedCredential["response"]) {
	return Object.create(
		AuthenticatorAttestationResponse.prototype,
		own({
			clientDataJSON: buffer(response.clientDataJSON),
			attestationObject: buffer(response.attestationObject),
			getTransports: () => [...response.transports],
			getAuthenticatorData: () => buffer(response.authenticatorData),
			getPublicKey: () => buffer(response.publicKey),
			getPublicKeyAlgorithm: () => response.publicKeyAlgorithm,
		}),
	);
}

function assertionResponse(response: Assertion["response"]) {
	return Object.create(
		AuthenticatorAssertionResponse.prototype,
		own({
			clientDataJSON: buffer(response.clientDataJSON),
			authenticatorData: buffer(response.authenticatorData),
			signature: buffer(response.signature),
			userHandle: buffer(response.userHandle),
		}),
	);
}
