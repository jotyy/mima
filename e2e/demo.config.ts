import { defineConfig, devices } from "@playwright/test";

// Not tests: `bun run demo:seed` empties the demo at demo.vauly.app, fills it with the
// example team through the app itself, and keeps that as what the demo goes back to every
// hour. It reads the demo's settings from the environment: VAULY_SETUP_CODE,
// VAULY_DEMO_TOKEN, VAULY_DEMO_EMAIL and VAULY_DEMO_PASSWORD.
export const DEMO_URL = process.env.VAULY_DEMO_URL ?? "https://demo.vauly.app";
export const DEMO_API =
	process.env.VAULY_DEMO_API ?? "https://demo-api.vauly.app";

export default defineConfig({
	testDir: "./demo",
	timeout: 900_000,
	expect: { timeout: 30_000 },
	reporter: "list",
	outputDir: "results/demo",
	use: {
		baseURL: DEMO_URL,
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
		viewport: { width: 1440, height: 900 },
	},
});
