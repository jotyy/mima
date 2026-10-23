import { describe, expect, test } from "bun:test";

import { parseRange, pwnedCount, sha1Hex } from "./pwned-passwords";

// SHA-1 of "password1" is E38AD214943DAAD1D64C102FAEC29DE4AFE9DA3D.
const PREFIX = "E38AD";
const SUFFIX = "214943DAAD1D64C102FAEC29DE4AFE9DA3D";

describe("sha1Hex", () => {
	test("gives the uppercase hex the service uses", async () => {
		expect(await sha1Hex("password1")).toBe(PREFIX + SUFFIX);
	});
});

describe("parseRange", () => {
	test("keeps the counts and drops the padding", () => {
		const range = parseRange(
			`0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${SUFFIX}:2413945\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0\r\n`,
		);
		expect(range.get(SUFFIX)).toBe(2413945);
		expect(range.get("0018A45C4D1DEF81644B54AB7F969B88D65")).toBe(3);
		expect(range.has("00D4F6E8FA6EECAD2A3AA415EEC418D38EC")).toBe(false);
	});
});

describe("pwnedCount", () => {
	test("sends only the first five characters of the hash", async () => {
		const asked: string[] = [];
		const count = await pwnedCount("password1", async (prefix) => {
			asked.push(prefix);
			return new Map([[SUFFIX, 24]]);
		});
		expect(asked).toEqual([PREFIX]);
		expect(count).toBe(24);
	});

	test("is 0 for a password the service hasn't seen", async () => {
		const count = await pwnedCount(
			"a password nobody has used",
			async () => new Map([[SUFFIX, 24]]),
		);
		expect(count).toBe(0);
	});
});
