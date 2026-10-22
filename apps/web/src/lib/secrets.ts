// One-time codes (RFC 6238), password strength and generation. Everything runs locally.

type TotpConfig = {
	secret: string;
	digits: number;
	period: number;
	algorithm: "SHA-1" | "SHA-256" | "SHA-512";
};

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

function base32(text: string) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
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

export type Strength = "weak" | "fair" | "strong";

const common =
	/^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123)/i;

export function passwordStrength(password: string): Strength {
	if (password.length < 10 || common.test(password)) return "weak";
	if (/^\d+$/.test(password) || /(.)\1{3,}/.test(password)) return "weak";
	let pool = 0;
	if (/[a-z]/.test(password)) pool += 26;
	if (/[A-Z]/.test(password)) pool += 26;
	if (/\d/.test(password)) pool += 10;
	if (/[^a-zA-Z0-9]/.test(password)) pool += 32;
	const bits = password.length * Math.log2(Math.max(pool, 2));
	if (bits < 50) return "weak";
	if (bits < 75) return "fair";
	return "strong";
}

const sets = {
	lower: "abcdefghijkmnopqrstuvwxyz",
	upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
	digits: "23456789",
	symbols: "!#$%&*+-=?@^_~",
};

function pick(chars: string) {
	const limit = 256 - (256 % chars.length);
	for (;;) {
		const [byte = 0] = crypto.getRandomValues(new Uint8Array(1));
		if (byte < limit) return chars[byte % chars.length] as string;
	}
}

/** A random password without look-alike characters (l, 1, O, 0). */
export function generatePassword(length = 20, symbols = true) {
	const groups = [
		sets.lower,
		sets.upper,
		sets.digits,
		...(symbols ? [sets.symbols] : []),
	];
	const all = groups.join("");
	const chars = groups.map(pick);
	while (chars.length < length) chars.push(pick(all));
	for (let i = chars.length - 1; i > 0; i--) {
		const [byte = 0] = crypto.getRandomValues(new Uint8Array(1));
		const j = byte % (i + 1);
		[chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
	}
	return chars.join("");
}

/** Why a new master password can't be used, or null when it's fine. */
export function newMasterPasswordProblem(password: string, repeated: string) {
	if (password.length < 12) {
		return "Use at least 12 characters for your master password.";
	}
	if (passwordStrength(password) === "weak") {
		return "That master password is easy to guess. Add more words or characters.";
	}
	if (password !== repeated) return "The two passwords don't match.";
	return null;
}
