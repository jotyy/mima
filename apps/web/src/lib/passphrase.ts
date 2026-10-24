// Passphrases: words picked at random from the EFF's large wordlist, which is made for
// this: 7,776 short, common, distinct words (https://www.eff.org/dice). The list in
// eff-large-wordlist.txt is EFF's file as published, © Electronic Frontier Foundation,
// under CC BY 3.0 US (https://creativecommons.org/licenses/by/3.0/us/). It's loaded only
// when someone asks for words.

/**
 * The words used: the list without its four hyphenated entries (drop-down, felt-tip,
 * t-shirt and yo-yo), so a passphrase splits back into its words whatever the separator.
 */
export const WORD_COUNT = 7772;

export const SEPARATORS = ["-", " ", ".", "_"] as const;
export type Separator = (typeof SEPARATORS)[number];

export const MIN_WORDS = 4;
export const MAX_WORDS = 8;

export type PassphraseOptions = {
	words: number;
	separator: Separator;
	/** Each word starts with a capital letter. */
	capitals: boolean;
	/** One of the words, picked at random, ends with a digit. */
	digit: boolean;
};

/** The words of EFF's list: lines of dice numbers, a tab and a word. */
export function parseWordlist(text: string) {
	return text
		.split("\n")
		.map((line) => line.split("\t")[1]?.trim() ?? "")
		.filter((word) => /^[a-z]+$/.test(word));
}

let wordlist: Promise<string[]> | null = null;

export function loadWordlist() {
	wordlist ??= import("./eff-large-wordlist.txt?raw").then(
		({ default: text }) => parseWordlist(text),
	);
	return wordlist;
}

type Random = (values: Uint32Array) => void;
const cryptoRandom: Random = (values) => {
	crypto.getRandomValues(values);
};

/**
 * A random whole number from 0 up to, not including, `n`. Values from the top of the
 * 32-bit range, past the last whole multiple of `n`, are drawn again, so every result is
 * equally likely: taking the remainder of them would favour the small ones.
 */
export function randomBelow(n: number, random: Random = cryptoRandom) {
	const limit = 2 ** 32 - (2 ** 32 % n);
	const value = new Uint32Array(1);
	for (;;) {
		random(value);
		const drawn = value[0] ?? 0;
		if (drawn < limit) return drawn % n;
	}
}

export function generatePassphrase(
	words: readonly string[],
	options: PassphraseOptions,
	random: Random = cryptoRandom,
) {
	const picked = Array.from({ length: options.words }, () => {
		const word = words[randomBelow(words.length, random)] ?? "";
		return options.capitals
			? (word[0]?.toUpperCase() ?? "") + word.slice(1)
			: word;
	});
	if (options.digit) {
		const at = randomBelow(picked.length, random);
		picked[at] = `${picked[at]}${randomBelow(10, random)}`;
	}
	return picked.join(options.separator);
}

/**
 * How many guesses a passphrase like this takes, as bits: each word is one of
 * WORD_COUNT, and the digit is one of ten on one of the words. Capitals on every word
 * add nothing.
 */
export function passphraseBits({
	words,
	digit,
}: Pick<PassphraseOptions, "words" | "digit">) {
	return words * Math.log2(WORD_COUNT) + (digit ? Math.log2(10 * words) : 0);
}

/**
 * The words of something shaped like a passphrase: three or more words of letters, each
 * perhaps capitalised or ending in a digit, with one separator between them. Null for
 * anything else.
 */
export function passphraseShape(text: string) {
	const separator = SEPARATORS.find((candidate) => text.includes(candidate));
	if (!separator) return null;
	const words = text.split(separator);
	const shaped = words.every((word) => /^[A-Za-z][a-z]{2,}\d?$/.test(word));
	if (words.length < 3 || !shaped) return null;
	return {
		words: words.length,
		digit: words.some((word) => /\d$/.test(word)),
	};
}
