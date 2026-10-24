/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
	cardBrand,
	formatCardNumber,
	lastFour,
	luhnValid,
	normalizeExpiry,
	shortExpiry,
} from "./cards";

// Every number here is a published test number; none is a real card.

describe("cardBrand", () => {
	test("knows a brand by its first digits", () => {
		const cases: [string, string][] = [
			["4111 1111 1111 1111", "Visa"],
			["5555555555554444", "Mastercard"],
			["2223003122003222", "Mastercard"],
			["378282246310005", "American Express"],
			["6011111111111117", "Discover"],
			["30569309025904", "Diners Club"],
			["3530111333300000", "JCB"],
			["6200000000000005", "UnionPay"],
		];
		for (const [number, brand] of cases) {
			expect(cardBrand(number)?.name, number).toBe(brand);
		}
		expect(cardBrand("9999 0000")).toBeNull();
		expect(cardBrand("")).toBeNull();
	});
});

test("luhnValid catches a mistyped digit", () => {
	expect(luhnValid("4111 1111 1111 1111")).toBe(true);
	expect(luhnValid("4111 1111 1111 1112")).toBe(false);
	expect(luhnValid("4111")).toBe(false);
});

test("numbers are grouped the way the card prints them", () => {
	expect(formatCardNumber("4111111111111111")).toBe("4111 1111 1111 1111");
	expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
	expect(lastFour("4111 1111 1111 1111")).toBe("1111");
});

describe("expiry", () => {
	test("each app's way of writing it becomes MM/YYYY", () => {
		const cases: [string, string | undefined, string][] = [
			["6/30", undefined, "06/2030"],
			["06/2030", undefined, "06/2030"],
			["2030-06", undefined, "06/2030"],
			["203006", undefined, "06/2030"],
			["03 / 23", undefined, "03/2023"],
			["6", "2030", "06/2030"],
			["12", "30", "12/2030"],
		];
		for (const [value, year, expiry] of cases) {
			expect(normalizeExpiry(value, year), `${value} ${year ?? ""}`).toBe(
				expiry,
			);
		}
		for (const nonsense of ["13/30", "0/30", "soon", "", "2030"]) {
			expect(normalizeExpiry(nonsense)).toBe("");
		}
		expect(shortExpiry("06/2030")).toBe("06/30");
	});
});
