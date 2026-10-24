// Password strength and generation, and the one-time codes shared with the extension.
// Everything runs locally.

import { passphraseBits, passphraseShape, randomBelow } from "./passphrase";

export { parseTotp, totpCode, totpSecondsLeft } from "@vauly/crypto";

export type Strength = "weak" | "fair" | "strong";

const common =
	/^(password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123)/i;

/**
 * About how many guesses a password takes, as bits. Words between separators count as
 * words from a list the size of the generator's, so a generated passphrase gets exactly
 * the bits the generator gives it, and a typed one isn't mistaken for random letters.
 * Anything else counts as random characters from the kinds it uses.
 */
export function passwordBits(password: string) {
	const phrase = passphraseShape(password);
	if (phrase) return passphraseBits(phrase);
	let pool = 0;
	if (/[a-z]/.test(password)) pool += 26;
	if (/[A-Z]/.test(password)) pool += 26;
	if (/\d/.test(password)) pool += 10;
	if (/[^a-zA-Z0-9]/.test(password)) pool += 32;
	return password.length * Math.log2(Math.max(pool, 2));
}

export function strengthOfBits(bits: number): Strength {
	if (bits < 50) return "weak";
	if (bits < 75) return "fair";
	return "strong";
}

export function passwordStrength(password: string): Strength {
	if (password.length < 10 || common.test(password)) return "weak";
	if (/^\d+$/.test(password) || /(.)\1{3,}/.test(password)) return "weak";
	return strengthOfBits(passwordBits(password));
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

/** The bits of a password generatePassword makes: its length, in characters of its set. */
export function generatedPasswordBits(length: number, symbols: boolean) {
	const size =
		sets.lower.length +
		sets.upper.length +
		sets.digits.length +
		(symbols ? sets.symbols.length : 0);
	return length * Math.log2(size);
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
		const j = randomBelow(i + 1);
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

/**
 * Why a backup's password can't be used, or null when it's fine. The file holds every
 * item someone can open, and anyone who has it can guess at it as long as they like, so
 * it needs a master password's strength. The master password itself would make the file
 * a way to test guesses at it.
 */
export function newBackupPasswordProblem(
	password: string,
	repeated: string,
	masterPassword: string,
) {
	if (!password) return "Choose a password for the backup.";
	if (password.length < 12) {
		return "Use at least 12 characters for the backup password, or the suggested passphrase.";
	}
	if (passwordStrength(password) === "weak") {
		return "That backup password is easy to guess. Add more words or characters, or use the suggested passphrase.";
	}
	if (password.normalize("NFKC") === masterPassword.normalize("NFKC")) {
		return "Use a different password from your master password.";
	}
	if (password !== repeated) return "The two backup passwords don't match.";
	return null;
}
