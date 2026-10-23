// One-time codes (RFC 6238), shared by the web app and the browser extension.

export type TotpConfig = {
	secret: string;
	digits: number;
	period: number;
	algorithm: "SHA-1" | "SHA-256" | "SHA-512";
};

/** Reads a base32 setup key or an otpauth:// link. Returns null when there's nothing to read. */
export function parseTotp(input: string): TotpConfig | null {
	const text = input.trim();
	if (!text) return null;
	if (text.startsWith("otpauth://")) {
		try {
			const url = new URL(text);
			const secret = url.searchParams.get("secret");
			if (!secret) return null;
			const algorithm = (
				url.searchParams.get("algorithm") ?? "SHA1"
			).toUpperCase();
			return {
				secret,
				digits: Number(url.searchParams.get("digits") ?? 6),
				period: Number(url.searchParams.get("period") ?? 30),
				algorithm:
					algorithm === "SHA256"
						? "SHA-256"
						: algorithm === "SHA512"
							? "SHA-512"
							: "SHA-1",
			};
		} catch {
			return null;
		}
	}
	return { secret: text, digits: 6, period: 30, algorithm: "SHA-1" };
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32(text: string) {
	const alphabet = BASE32;
	const clean = text.toUpperCase().replace(/[\s=-]/g, "");
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const char of clean) {
		const index = alphabet.indexOf(char);
		if (index < 0) throw new Error("Not a base32 secret");
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return new Uint8Array(out);
}

export async function totpCode(config: TotpConfig, now = Date.now()) {
	const counter = Math.floor(now / 1000 / config.period);
	const message = new Uint8Array(8);
	new DataView(message.buffer).setBigUint64(0, BigInt(counter));
	const key = await crypto.subtle.importKey(
		"raw",
		base32(config.secret),
		{ name: "HMAC", hash: config.algorithm },
		false,
		["sign"],
	);
	const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
	const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
	const binary =
		(((mac[offset] ?? 0) & 0x7f) << 24) |
		((mac[offset + 1] ?? 0) << 16) |
		((mac[offset + 2] ?? 0) << 8) |
		(mac[offset + 3] ?? 0);
	return String(binary % 10 ** config.digits).padStart(config.digits, "0");
}

/** Seconds until the current code changes. */
export function totpSecondsLeft(config: TotpConfig, now = Date.now()) {
	return config.period - (Math.floor(now / 1000) % config.period);
}

/** A new random setup key: 160 bits in base32, the way authenticator apps expect it. */
export function newTotpSecret() {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	let bits = 0;
	let value = 0;
	let out = "";
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += BASE32[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
		value &= (1 << bits) - 1;
	}
	return out;
}

/**
 * Checks a six-digit code made from `secret` with the usual settings (SHA-1, every 30
 * seconds), allowing one step either side for a clock that's off. Returns the step it
 * matched, or null. Steps at or before `after` are refused, so a code works only once.
 */
export async function verifyTotp(
	secret: string,
	code: string,
	{ now = Date.now(), after = -1 }: { now?: number; after?: number } = {},
) {
	const digits = code.replace(/\s/g, "");
	if (!/^\d{6}$/.test(digits)) return null;
	const config = { secret, digits: 6, period: 30, algorithm: "SHA-1" } as const;
	const current = Math.floor(now / 30_000);
	for (const step of [current - 1, current, current + 1]) {
		if (step <= after) continue;
		if ((await totpCode(config, step * 30_000)) === digits) return step;
	}
	return null;
}
