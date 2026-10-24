import { fromBase64Url } from "./web-push";

// What a browser does with a push: RFC 8291 from the receiving end. Only the tests use it,
// the unit tests and the e2e suite's stand-in push service, to read what the server sent.

const encoder = new TextEncoder();
const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

type Bytes = Uint8Array<ArrayBuffer>;

async function hkdf(
	salt: Bytes,
	ikm: ArrayBuffer | Bytes,
	info: Bytes,
	length: number,
) {
	const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt, info },
		key,
		length * 8,
	);
	return new Uint8Array(bits);
}

/** The message in a push's body, for the browser whose key pair is `privateKey`. */
export async function decryptPush(
	body: Bytes,
	privateKey: JsonWebKey,
	auth: string,
) {
	const salt = body.slice(0, 16);
	const keyLength = body[20] ?? 0;
	const sender = body.slice(21, 21 + keyLength);
	const record = body.slice(21 + keyLength);
	const own = new Uint8Array([
		4,
		...fromBase64Url(privateKey.x ?? ""),
		...fromBase64Url(privateKey.y ?? ""),
	]);
	const [mine, theirs] = await Promise.all([
		crypto.subtle.importKey("jwk", privateKey, P256, false, ["deriveBits"]),
		crypto.subtle.importKey("raw", sender, P256, false, []),
	]);
	const shared = await crypto.subtle.deriveBits(
		{ name: "ECDH", public: theirs },
		mine,
		256,
	);
	const ikm = await hkdf(
		fromBase64Url(auth),
		shared,
		new Uint8Array([...encoder.encode("WebPush: info\0"), ...own, ...sender]),
		32,
	);
	const key = await hkdf(
		salt,
		ikm,
		encoder.encode("Content-Encoding: aes128gcm\0"),
		16,
	);
	const nonce = await hkdf(
		salt,
		ikm,
		encoder.encode("Content-Encoding: nonce\0"),
		12,
	);
	const aes = await crypto.subtle.importKey("raw", key, "AES-GCM", false, [
		"decrypt",
	]);
	const padded = new Uint8Array(
		await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, record),
	);
	if (padded.at(-1) !== 2) throw new Error("Not the last record");
	return new TextDecoder().decode(padded.slice(0, -1));
}
