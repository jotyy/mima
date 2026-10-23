import { describe, expect, test } from "bun:test";

import {
	newTotpSecret,
	parseTotp,
	totpCode,
	totpSecondsLeft,
	verifyTotp,
} from "./totp";

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

describe("two-step login", () => {
	test("a new setup key is 160 bits of base32", () => {
		const secret = newTotpSecret();
		expect(secret).toMatch(/^[A-Z2-7]{32}$/);
		expect(newTotpSecret()).not.toBe(secret);
	});

	test("a code works in its step and the ones next to it, once", async () => {
		const secret = newTotpSecret();
		const config = parseTotp(secret);
		if (!config) throw new Error("no config");
		const now = 1_800_000_000_000;
		const code = await totpCode(config, now);
		const step = await verifyTotp(secret, code, { now });
		expect(step).toBe(Math.floor(now / 30_000));
		// Thirty seconds late still counts; a minute and a half doesn't.
		expect(await verifyTotp(secret, code, { now: now + 30_000 })).toBe(step);
		expect(await verifyTotp(secret, code, { now: now + 90_000 })).toBeNull();
		// Used once, it's refused.
		expect(
			await verifyTotp(secret, code, { now, after: step ?? 0 }),
		).toBeNull();
	});

	test("anything but six digits is refused", async () => {
		const secret = newTotpSecret();
		expect(await verifyTotp(secret, "12345")).toBeNull();
		expect(await verifyTotp(secret, "abcdef")).toBeNull();
	});
});
