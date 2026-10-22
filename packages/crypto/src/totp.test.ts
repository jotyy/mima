import { describe, expect, test } from "bun:test";

import { parseTotp, totpCode, totpSecondsLeft } from "./totp";

// RFC 6238, appendix B: the SHA-1 test key "12345678901234567890", in base32.
const rfcKey = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpCode", () => {
	test("matches the RFC 6238 test vectors", async () => {
		const config = {
			secret: rfcKey,
			digits: 8,
			period: 30,
			algorithm: "SHA-1",
		} as const;
		expect(await totpCode(config, 59_000)).toBe("94287082");
		expect(await totpCode(config, 1_111_111_109_000)).toBe("07081804");
		expect(await totpCode(config, 2_000_000_000_000)).toBe("69279037");
	});

	test("ignores spaces and lower case in a setup key", async () => {
		const spaced = parseTotp("gezd gnbv gy3t qojq gezd gnbv gy3t qojq");
		const plain = parseTotp(rfcKey);
		expect(spaced && (await totpCode(spaced, 59_000))).toBe(
			plain && (await totpCode(plain, 59_000)),
		);
	});
});

describe("parseTotp", () => {
	test("reads an otpauth link", () => {
		expect(
			parseTotp(
				`otpauth://totp/Example:alex@example.test?secret=${rfcKey}&digits=8&period=60&algorithm=SHA256`,
			),
		).toEqual({ secret: rfcKey, digits: 8, period: 60, algorithm: "SHA-256" });
	});

	test("defaults a bare key to six digits every 30 seconds", () => {
		expect(parseTotp(rfcKey)).toEqual({
			secret: rfcKey,
			digits: 6,
			period: 30,
			algorithm: "SHA-1",
		});
		expect(parseTotp("  ")).toBeNull();
		expect(parseTotp("otpauth://totp/x?issuer=nothing")).toBeNull();
	});
});

test("totpSecondsLeft counts down within the period", () => {
	const config = parseTotp(rfcKey);
	if (!config) throw new Error("no config");
	expect(totpSecondsLeft(config, 0)).toBe(30);
	expect(totpSecondsLeft(config, 29_000)).toBe(1);
});
