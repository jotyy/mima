// Writes test-vectors.json: fixed, made-up inputs and what vauly's formats make of them.
// The outputs come from the formats as docs/security.md describes them, computed here
// step by step with plain WebCrypto, not by calling packages/crypto, so the unit test
// (src/vectors.test.ts) checks the package against an independent reading of the format.
//
//   bun run vectors     (in packages/crypto)

import path from "node:path";

const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromB64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));
/** `length` bytes counting up from `start`: easy to recognize, obviously not random. */
const run = (start: number, length: number) =>
	Uint8Array.from({ length }, (_, i) => (start + i) & 0xff);

// --- Fixed inputs -----------------------------------------------------------------

/** Made-up P-256 key pairs, as PKCS#8. They protect nothing. */
const keyPairs = {
	account:
		"MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg39xIWH6p27YIMw3m4kGCDMC3dOnRc2F6c1sPBxfPy/uhRANCAATYf8lz1wcc3Jf7vbCOPXrpBfh01PqCxIgYnnnXuos/ZtVBtxucWy4s1QrORnTJ9TBQWA+c9fCF9EZ2ptfy85EA",
	recipient:
		"MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg69o/mAN9LikgDta6+hURNbky7edYcCvtEdl6BPc3zxehRANCAAQTFth9I28Gi/QAcbdotbLGtvfpX1H/k8NwY3czo6nCKaA56+UO1qExP9izIPRufBHV6mt0batJ+TDXNlx2AcMN",
	ephemeral:
		"MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgaNrV0Wa+6KqC8dnbF9QpjTqAGdDg5Xmm8c89aVQAiF6hRANCAASDcOaVmRlefddHVYvhffRp1AldOf16jbuaqavcrHZCVKkihaDbTKXAE3t+224TsjCgqRapZ8zjyrmbAFgYcOSU",
	agent:
		"MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQguIlIgAcUvyQupF3/EcWWJ0zMgRrlsGuIlw3/sW6HCaahRANCAATkpNixrPNOUH9k/3y0pf+nQ0vp+qfl99WVzbqzh6GDN7eR8c8DlkXG6geDvpY9xragMGvejAsrIvraTEAImnv+",
};

const itemKey = run(0x40, 32);
const vaultKey = run(0x60, 32);
const iv = (n: number) => run(0xa0 + n * 0x10, 12);

// --- The formats, step by step -----------------------------------------------------

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password.normalize("NFKC")),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "PBKDF2", hash: "SHA-256", salt, iterations },
			key,
			256,
		),
	);
}

/** HKDF-SHA-256 with 32 zero bytes of salt, 32 bytes out. */
async function hkdf(secret: Uint8Array, info: string) {
	const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
		"deriveBits",
	]);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: "HKDF",
				hash: "SHA-256",
				salt: new Uint8Array(32),
				info: encoder.encode(info),
			},
			key,
			256,
		),
	);
}

/** AES-256-GCM, a 12-byte IV and a 16-byte tag: `base64(iv).base64(ciphertext ‖ tag)`. */
async function seal(
	keyBytes: Uint8Array,
	ivBytes: Uint8Array,
	data: Uint8Array,
) {
	const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
		"encrypt",
	]);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: ivBytes },
		key,
		data,
	);
	return `${b64(ivBytes)}.${b64(new Uint8Array(ciphertext))}`;
}

async function masterKeys(
	password: string,
	salt: Uint8Array,
	iterations: number,
) {
	const masterKey = await pbkdf2(password, salt, iterations);
	return {
		masterKey,
		authKey: hex(await hkdf(masterKey, "vauly/auth")),
		wrapKey: await hkdf(masterKey, "vauly/wrap"),
	};
}

async function publicKeyOf(pkcs8: string) {
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		fromB64(pkcs8),
		ECDH,
		true,
		["deriveBits"],
	);
	const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", privateKey);
	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{ kty, crv, x, y },
		ECDH,
		true,
		[],
	);
	return b64(new Uint8Array(await crypto.subtle.exportKey("spki", publicKey)));
}

async function ecdh(pkcs8: string, spki: string) {
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		fromB64(pkcs8),
		ECDH,
		false,
		["deriveBits"],
	);
	const publicKey = await crypto.subtle.importKey(
		"spki",
		fromB64(spki),
		ECDH,
		false,
		[],
	);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: "ECDH", public: publicKey },
			privateKey,
			256,
		),
	);
}

const base64Url = (bytes: Uint8Array) =>
	b64(bytes).replace(/\+/g, "-").replace(/\//g, "_");

// --- The vectors ---------------------------------------------------------------------

async function masterKeyVector(
	password: string,
	salt: Uint8Array,
	iterations: number,
	checkIv: Uint8Array,
) {
	const keys = await masterKeys(password, salt, iterations);
	return {
		password,
		passwordNfkc: password.normalize("NFKC"),
		salt: b64(salt),
		iterations,
		masterKey: hex(keys.masterKey),
		authKey: keys.authKey,
		wrapKey: hex(keys.wrapKey),
		wrapKeyCheck: {
			iv: b64(checkIv),
			plaintext: "vauly",
			sealed: await seal(keys.wrapKey, checkIv, encoder.encode("vauly")),
		},
	};
}

async function sealVector(plaintext: string, ivBytes: Uint8Array) {
	return {
		key: b64(itemKey),
		iv: b64(ivBytes),
		plaintext,
		sealed: await seal(itemKey, ivBytes, encoder.encode(plaintext)),
	};
}

async function accountVector() {
	const password = "correct horse battery staple";
	const salt = run(0x00, 16);
	const iterations = 1000;
	const keys = await masterKeys(password, salt, iterations);
	const publicKey = await publicKeyOf(keyPairs.account);
	return {
		password,
		iterations,
		salt: b64(salt),
		privateKey: keyPairs.account,
		publicKey,
		iv: b64(iv(4)),
		authKey: keys.authKey,
		keys: {
			kdfSalt: b64(salt),
			kdfIterations: iterations,
			publicKey,
			encryptedPrivateKey: await seal(
				keys.wrapKey,
				iv(4),
				fromB64(keyPairs.account),
			),
		},
	};
}

const account = await accountVector();
const recipientPublicKey = await publicKeyOf(keyPairs.recipient);
const ephemeralPublicKey = await publicKeyOf(keyPairs.ephemeral);
const sharedSecret = await ecdh(keyPairs.ephemeral, recipientPublicKey);
const shareInfo = `vauly/share:${recipientPublicKey}`;
const shareKey = await hkdf(sharedSecret, shareInfo);

const nextPassword = "a new and longer passphrase";
const nextSalt = run(0x10, 16);
const nextKeys = await masterKeys(nextPassword, nextSalt, 1000);

const item = { kind: "login", name: "Example", username: "alex@example.test" };

const agentId = "agent_0123456789";
const agentSecret = hex(run(0x80, 24));

/** RFC 6238, appendix B. The codes are the RFC's; this script checks it agrees. */
const rfcSeeds = {
	"SHA-1": "12345678901234567890",
	"SHA-256": "12345678901234567890123456789012",
	"SHA-512": "1234567890123456789012345678901234567890123456789012345678901234",
};
const rfcCodes: [number, string, string, string][] = [
	[59, "94287082", "46119246", "90693936"],
	[1111111109, "07081804", "68084774", "25091201"],
	[1111111111, "14050471", "67062674", "99943326"],
	[1234567890, "89005924", "91819424", "93441116"],
	[2000000000, "69279037", "90698825", "38618901"],
	[20000000000, "65353130", "77737706", "47863826"],
];

function base32(bytes: Uint8Array) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += alphabet[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
	}
	if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
	return out;
}

async function hotp(seed: Uint8Array, hash: string, counter: number) {
	const key = await crypto.subtle.importKey(
		"raw",
		seed,
		{ name: "HMAC", hash },
		false,
		["sign"],
	);
	const message = new Uint8Array(8);
	new DataView(message.buffer).setBigUint64(0, BigInt(counter));
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
	const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
	const code =
		(((mac[offset] ?? 0) & 0x7f) << 24) |
		((mac[offset + 1] ?? 0) << 16) |
		((mac[offset + 2] ?? 0) << 8) |
		(mac[offset + 3] ?? 0);
	return String(code % 1e8).padStart(8, "0");
}

const totp = [];
for (const [time, ...codes] of rfcCodes) {
	for (const [index, [algorithm, seed]] of Object.entries(rfcSeeds).entries()) {
		const code = codes[index] ?? "";
		const computed = await hotp(
			encoder.encode(seed),
			algorithm,
			Math.floor(time / 30),
		);
		if (computed !== code) {
			throw new Error(`RFC 6238 disagrees at ${time}, ${algorithm}`);
		}
		totp.push({
			secret: base32(encoder.encode(seed)),
			algorithm,
			digits: 8,
			period: 30,
			time,
			code,
		});
	}
}

const prfOutput = run(0xd0, 32);
const device = await hkdf(prfOutput, "vauly/device");

const vectors = {
	about:
		"Test vectors for vauly's cryptography (packages/crypto). Every value is made up. Bytes are base64 (standard alphabet, padded) unless a field says hex. docs/security.md describes the formats; regenerate with `bun run vectors` in packages/crypto.",
	masterKeys: [
		await masterKeyVector(
			"correct horse battery staple",
			run(0x00, 16),
			600_000,
			iv(0),
		),
		await masterKeyVector("Ｐａｓｓ ｗｏｒｄ ﬁ①", run(0x10, 16), 1000, iv(1)),
	],
	seal: [
		await sealVector("Hello, vauly", iv(2)),
		await sealVector("", iv(3)),
		await sealVector("Grüße, 你好 🔐", iv(5)),
	],
	sealJson: [
		{
			key: b64(itemKey),
			iv: b64(iv(6)),
			value: item,
			json: JSON.stringify(item),
			sealed: await seal(itemKey, iv(6), encoder.encode(JSON.stringify(item))),
		},
	],
	wrapKey: [
		{
			wrappingKey: b64(vaultKey),
			key: b64(itemKey),
			iv: b64(iv(7)),
			wrapped: await seal(vaultKey, iv(7), itemKey),
		},
	],
	wrapKeyFor: [
		{
			recipientPrivateKey: keyPairs.recipient,
			recipientPublicKey,
			ephemeralPrivateKey: keyPairs.ephemeral,
			ephemeralPublicKey,
			key: b64(vaultKey),
			sharedSecret: hex(sharedSecret),
			info: shareInfo,
			wrappingKey: hex(shareKey),
			iv: b64(iv(8)),
			wrapped: `${ephemeralPublicKey}:${await seal(shareKey, iv(8), vaultKey)}`,
		},
	],
	linkKey: [{ key: b64(itemKey), text: base64Url(itemKey).replace(/=+$/, "") }],
	createAccount: [account],
	changeMasterPassword: [
		{
			current: account.password,
			next: nextPassword,
			keys: account.keys,
			iterations: 1000,
			salt: b64(nextSalt),
			iv: b64(iv(9)),
			currentAuthKey: account.authKey,
			authKey: nextKeys.authKey,
			nextKeys: {
				kdfSalt: b64(nextSalt),
				kdfIterations: 1000,
				publicKey: account.publicKey,
				encryptedPrivateKey: await seal(
					nextKeys.wrapKey,
					iv(9),
					fromB64(keyPairs.account),
				),
			},
		},
	],
	deviceKey: [
		{
			prfOutput: b64(prfOutput),
			info: "vauly/device",
			deviceKey: hex(device),
			privateKey: keyPairs.account,
			iv: b64(iv(10)),
			sealedPrivateKey: await seal(device, iv(10), fromB64(keyPairs.account)),
		},
	],
	agentToken: [
		{
			agentId,
			secret: agentSecret,
			privateKey: keyPairs.agent,
			token: `vauly_agent_${agentId}.${agentSecret}.${base64Url(fromB64(keyPairs.agent))}`,
			secretHash: hex(
				new Uint8Array(
					await crypto.subtle.digest("SHA-256", encoder.encode(agentSecret)),
				),
			),
		},
	],
	totp,
	parseTotp: [
		{
			input:
				"otpauth://totp/Example:alex@example.test?secret=JBSWY3DPEHPK3PXP&issuer=Example",
			config: {
				secret: "JBSWY3DPEHPK3PXP",
				digits: 6,
				period: 30,
				algorithm: "SHA-1",
			},
		},
		{
			input:
				"otpauth://totp/Example?secret=GEZDGNBVGY3TQOJQ&digits=8&period=60&algorithm=SHA256",
			config: {
				secret: "GEZDGNBVGY3TQOJQ",
				digits: 8,
				period: 60,
				algorithm: "SHA-256",
			},
		},
		{
			input: "JBSWY3DPEHPK3PXP",
			config: {
				secret: "JBSWY3DPEHPK3PXP",
				digits: 6,
				period: 30,
				algorithm: "SHA-1",
			},
		},
	],
};

const file = path.join(import.meta.dir, "../test-vectors.json");
await Bun.write(file, `${JSON.stringify(vectors, null, "\t")}\n`);
// Formatted the way the repository's Biome check expects.
Bun.spawnSync(["bunx", "biome", "format", "--write", file], {
	stdout: "ignore",
});
console.log(`Wrote ${path.relative(process.cwd(), file)}`);
