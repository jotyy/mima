// base64url without padding, as WebAuthn's JSON uses it. Kept apart from passkey.ts so the
// script vauly adds to every page stays small.

export function toBase64Url(bytes: Uint8Array) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function fromBase64Url(text: string) {
	const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
	const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
