// Password strength and generation, and the one-time codes shared with the extension.
// Everything runs locally.

export { parseTotp, totpCode, totpSecondsLeft } from "@mima/crypto";

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
