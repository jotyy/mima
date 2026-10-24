// A pass for an agent to download one file of an item it was granted: it names the agent,
// the grant and the file, and when it stops working, signed with a key the server derives
// from its secret for passes alone. The server still checks the grant on every download,
// so revoking it ends the pass too.

const encoder = new TextEncoder();

export type Pass = {
	agentId: string;
	grantId: string;
	fileId: string;
	/** Milliseconds since the epoch. */
	until: number;
};

async function passKey(secret: string) {
	const base = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		"HKDF",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(32),
			info: encoder.encode("vauly/file-pass"),
		},
		base,
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		false,
		["sign", "verify"],
	);
}

const signed = (pass: Pass) =>
	encoder.encode(
		`vauly/file-pass\n${pass.agentId}\n${pass.grantId}\n${pass.fileId}\n${pass.until}`,
	);

const toBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

function fromBase64Url(text: string) {
	try {
		const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

/** `<file id>.<grant id>.<until>.<signature>` */
export async function signPass(secret: string, pass: Pass) {
	const signature = await crypto.subtle.sign(
		"HMAC",
		await passKey(secret),
		signed(pass),
	);
	return `${pass.fileId}.${pass.grantId}.${pass.until}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The grant and file a pass is for, if this agent's pass is genuine and still good. */
export async function readPass(
	secret: string,
	agentId: string,
	token: string,
	now = Date.now(),
) {
	const [fileId = "", grantId = "", rawUntil = "", rawSignature = ""] =
		token.split(".");
	const until = Number(rawUntil);
	// Written so that a missing or garbled time fails too.
	if (!(until >= now)) return null;
	const signature = fromBase64Url(rawSignature);
	if (!signature || !fileId || !grantId) return null;
	const genuine = await crypto.subtle.verify(
		"HMAC",
		await passKey(secret),
		signature,
		signed({ agentId, grantId, fileId, until }),
	);
	return genuine ? { fileId, grantId } : null;
}
