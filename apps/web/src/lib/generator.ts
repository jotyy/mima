import {
	generatePassphrase,
	loadWordlist,
	MAX_WORDS,
	MIN_WORDS,
	type PassphraseOptions,
	passphraseBits,
	SEPARATORS,
} from "./passphrase";
import { generatedPasswordBits, generatePassword } from "./secrets";

// The password generator's settings, which each device keeps: random characters, or
// words for something easier to type on a TV, a phone or a server console.

export type GeneratorSettings = {
	mode: "characters" | "words";
	length: number;
	symbols: boolean;
} & PassphraseOptions;

export const LENGTHS = [16, 20, 24, 32, 48, 64] as const;

export const defaultGeneratorSettings: GeneratorSettings = {
	mode: "characters",
	length: 20,
	symbols: true,
	words: 6,
	separator: "-",
	capitals: false,
	digit: false,
};

const KEY = "vauly.generator";

/** This device's settings, with anything missing or out of range back at its default. */
export function readGeneratorSettings(): GeneratorSettings {
	let saved: Partial<GeneratorSettings> = {};
	try {
		saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
	} catch {
		// Private windows can refuse storage; the defaults do.
	}
	const d = defaultGeneratorSettings;
	return {
		mode: saved.mode === "words" ? "words" : "characters",
		length: LENGTHS.find((length) => length === saved.length) ?? d.length,
		symbols: typeof saved.symbols === "boolean" ? saved.symbols : d.symbols,
		words:
			Number.isInteger(saved.words) &&
			(saved.words ?? 0) >= MIN_WORDS &&
			(saved.words ?? 0) <= MAX_WORDS
				? (saved.words as number)
				: d.words,
		separator:
			SEPARATORS.find((separator) => separator === saved.separator) ??
			d.separator,
		capitals: typeof saved.capitals === "boolean" ? saved.capitals : d.capitals,
		digit: typeof saved.digit === "boolean" ? saved.digit : d.digit,
	};
}

export function saveGeneratorSettings(settings: GeneratorSettings) {
	try {
		localStorage.setItem(KEY, JSON.stringify(settings));
	} catch {
		// Then the settings last until the page reloads.
	}
}

/** A new secret with these settings, and its strength in bits. */
export async function generateSecret(settings: GeneratorSettings) {
	if (settings.mode === "words") {
		return {
			value: generatePassphrase(await loadWordlist(), settings),
			bits: passphraseBits(settings),
		};
	}
	return {
		value: generatePassword(settings.length, settings.symbols),
		bits: generatedPasswordBits(settings.length, settings.symbols),
	};
}

/** What's offered as a master password: six words, typed easily, about 78 bits. */
export const MASTER_PASSPHRASE: PassphraseOptions = {
	words: 6,
	separator: "-",
	capitals: false,
	digit: false,
};
