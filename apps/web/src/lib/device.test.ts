import { describe, expect, test } from "bun:test";

import { describeDevice } from "./device";

describe("describeDevice", () => {
	test("names common browsers and systems", () => {
		expect(
			describeDevice(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			),
		).toEqual({ label: "Chrome on macOS", phone: false });
		expect(
			describeDevice(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
			).label,
		).toBe("Edge on Windows");
		expect(
			describeDevice(
				"Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
			).label,
		).toBe("Firefox on Linux");
	});

	test("tells phones apart", () => {
		expect(
			describeDevice(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
			),
		).toEqual({ label: "Safari on iPhone", phone: true });
		expect(
			describeDevice(
				"Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
			),
		).toEqual({ label: "Chrome on Android", phone: true });
	});

	test("falls back when it can't tell", () => {
		expect(describeDevice(null).label).toBe("Unknown device");
		expect(describeDevice("curl/8.7.1").label).toBe("Unknown device");
	});
});
