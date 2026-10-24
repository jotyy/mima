/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
	generatePassphrase,
	MAX_WORDS,
	MIN_WORDS,
	type PassphraseOptions,
	parseWordlist,
	passphraseBits,
	passphraseShape,
	randomBelow,
	SEPARATORS,
	WORD_COUNT,
} from "./passphrase";
import { passwordBits, passwordStrength } from "./secrets";

const file = readFileSync(new URL("./eff-large-wordlist.txt", import.meta.url));
const words = parseWordlist(file.toString("utf8"));
const list = new Set(words);

/** A random source that hands out these 32-bit values, and counts how many it gave. */
function scripted(values: number[]) {
	const source = (out: Uint32Array) => {
		const next = values.shift();
		if (next === undefined) throw new Error("Out of values");
		out[0] = next;
		source.calls++;
	};
	source.calls = 0;
	return source;
}

describe("the wordlist", () => {
	test("is EFF's large wordlist as published", () => {
		expect(createHash("sha256").update(file).digest("hex")).toBe(
			"addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e",
		);
	});

	test("leaves out the four hyphenated words, so every word is letters", () => {
		expect(words).toHaveLength(WORD_COUNT);
		expect(list.size).toBe(WORD_COUNT);
		expect(words.every((word) => /^[a-z]{3,9}$/.test(word))).toBe(true);
		for (const hyphenated of ["drop-down", "felt-tip", "t-shirt", "yo-yo"]) {
			expect(list.has(hyphenated)).toBe(false);
		}
	});
});

describe("randomBelow", () => {
	test("draws again past the last whole multiple, so no result is favoured", () => {
		const n = WORD_COUNT;
		const limit = 2 ** 32 - (2 ** 32 % n);
		expect(limit % n).toBe(0);
		// The top of the range would favour the smallest results: it's drawn again.
		const source = scripted([limit, 2 ** 32 - 1, limit - 1]);
		expect(randomBelow(n, source)).toBe((limit - 1) % n);
		expect(source.calls).toBe(3);
		expect(randomBelow(n, scripted([0]))).toBe(0);
		expect(randomBelow(n, scripted([n + 5]))).toBe(5);
	});

	test("lands evenly across small ranges", () => {
		const counts = [0, 0, 0];
		for (let i = 0; i < 30_000; i++) counts[randomBelow(3)]++;
		for (const count of counts)
			expect(Math.abs(count - 10_000)).toBeLessThan(500);
	});
});

describe("generatePassphrase", () => {
	const options: PassphraseOptions = {
		words: 6,
		separator: "-",
		capitals: false,
		digit: false,
	};

	test("joins words from the list with the separator", () => {
		for (const separator of SEPARATORS) {
			for (let count = MIN_WORDS; count <= MAX_WORDS; count++) {
				const phrase = generatePassphrase(words, {
					...options,
					words: count,
					separator,
				});
				const parts = phrase.split(separator);
				expect(parts).toHaveLength(count);
				for (const part of parts) expect(list.has(part)).toBe(true);
			}
		}
	});

	test("capitalises every word, and puts one digit on one of them", () => {
		const phrase = generatePassphrase(words, {
			...options,
			capitals: true,
			digit: true,
		});
		const parts = phrase.split("-");
		expect(parts.every((part) => /^[A-Z][a-z]+\d?$/.test(part))).toBe(true);
		expect(parts.filter((part) => /\d$/.test(part))).toHaveLength(1);
		for (const part of parts) {
			expect(list.has(part.replace(/\d$/, "").toLowerCase())).toBe(true);
		}
	});

	test("picks each word with the unbiased chooser", () => {
		// Every draw at the top of the range is thrown away before it picks a word.
		const limit = 2 ** 32 - (2 ** 32 % WORD_COUNT);
		const phrase = generatePassphrase(
			words,
			{ ...options, words: 4 },
			scripted([limit, 0, limit + 1, 1, 2, 2 ** 32 - 1, 3]),
		);
		expect(phrase).toBe(words.slice(0, 4).join("-"));
	});
});

describe("strength", () => {
	test("each word is worth log2 of the list's length; the digit, its place and value", () => {
		expect(passphraseBits({ words: 4, digit: false })).toBeCloseTo(51.7, 1);
		expect(passphraseBits({ words: 6, digit: false })).toBeCloseTo(77.5, 1);
		expect(passphraseBits({ words: 6, digit: true })).toBeCloseTo(83.5, 1);
	});

	test("the meter gives a generated passphrase the generator's bits", () => {
		for (let count = MIN_WORDS; count <= MAX_WORDS; count++) {
			for (const separator of SEPARATORS) {
				for (const flags of [
					{ capitals: false, digit: false },
					{ capitals: true, digit: true },
				]) {
					const settings = { words: count, separator, ...flags };
					const phrase = generatePassphrase(words, settings);
					expect(passwordBits(phrase)).toBeCloseTo(passphraseBits(settings), 6);
				}
			}
		}
		expect(passwordStrength("correct-horse-battery-staple")).toBe("fair");
		expect(passwordStrength("correct horse battery staple oak lantern")).toBe(
			"strong",
		);
	});

	test("typed phrases count as words, not as random letters", () => {
		expect(passphraseShape("correct horse battery staple")).toEqual({
			words: 4,
			digit: false,
		});
		expect(passwordStrength("correct horse battery")).toBe("weak");
		// Not a passphrase: random characters, or more than one kind of separator.
		expect(passphraseShape("x7#Kp2-mQ9")).toBeNull();
		expect(passphraseShape("correct-horse battery-staple")).toBeNull();
		expect(passwordStrength("Tq7#mV2p!xR9wK4z")).toBe("strong");
	});
});
