import { defineConfig, devices } from "@playwright/test";

// The suite starts its own stack (stage `e2e`, ports 3100/3101, its own D1) so it never
// touches the database behind `bun run dev`. Each spec file resets it first.
export const API_PORT = 3100;
export const WEB_PORT = 3101;
export const RESET_TOKEN = process.env.MIMA_E2E_RESET_TOKEN ?? "mima-e2e-local";
export const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
	testDir: "./tests",
	fullyParallel: false,
	workers: 1,
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: [["list"], ["html", { open: "never", outputFolder: "report" }]],
	outputDir: "results",
	use: {
		baseURL: `http://localhost:${WEB_PORT}`,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		...devices["Desktop Chrome"],
		viewport: { width: 1440, height: 900 },
	},
	webServer: {
		command: "bun run dev --stage e2e",
		cwd: "../packages/infra",
		url: `http://localhost:${WEB_PORT}`,
		env: {
			MIMA_API_PORT: String(API_PORT),
			MIMA_WEB_PORT: String(WEB_PORT),
			MIMA_E2E_RESET_TOKEN: RESET_TOKEN,
		},
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "ignore",
		stderr: "pipe",
	},
});
