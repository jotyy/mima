/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { BRANDFETCH_CLIENT_ID } from "@vauly/ui/lib/logos";

import { logoFor } from "./logos";

const github = {
	kind: "login" as const,
	name: "GitHub",
	url: "https://github.com",
};

describe("website logos in the extension", () => {
	test("from Brandfetch, with vauly's client ID or the instance's", () => {
		expect(logoFor(github, { instance: "", shown: true })).toBe(
			`https://cdn.brandfetch.io/github.com/w/56/h/56/fallback/404/icon?c=${BRANDFETCH_CLIENT_ID}`,
		);
		expect(logoFor(github, { instance: "own-id", shown: true })).toContain(
			"?c=own-id",
		);
	});

	test("none when this browser or the instance turned them off", () => {
		expect(logoFor(github, { instance: "", shown: false })).toBeNull();
		expect(logoFor(github, { instance: "off", shown: true })).toBeNull();
	});

	test("a card shows its brand's, never anything from its number", () => {
		expect(
			logoFor(
				{
					kind: "card",
					name: "Travel card",
					card: { number: "4242424242424242" },
				},
				{ instance: "", shown: true },
			),
		).toContain("cdn.brandfetch.io/visa.com/");
		expect(
			logoFor(
				{ kind: "card", name: "Store card", card: { number: "9999" } },
				{ instance: "", shown: true },
			),
		).toBeNull();
	});

	test("none for a private address", () => {
		expect(
			logoFor(
				{ kind: "login", name: "Wiki", url: "https://wiki.internal" },
				{ instance: "", shown: true },
			),
		).toBeNull();
	});
});
