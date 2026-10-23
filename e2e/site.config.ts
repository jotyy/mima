import { defineConfig, devices } from "@playwright/test";

// The website: built once, then served as static files, as a host would serve it.
export const SITE_PORT = 4322;

export default defineConfig({
	testDir: "./site",
	fullyParallel: true,
	timeout: 60_000,
	expect: { timeout: 10_000 },
	reporter: [["list"]],
	outputDir: "results/site",
	use: {
		baseURL: `http://localhost:${SITE_PORT}`,
		trace: "retain-on-failure",
		...devices["Desktop Chrome"],
		viewport: { width: 1440, height: 900 },
	},
	webServer: {
		command: `bun run --cwd ../apps/site build && PORT=${SITE_PORT} bun site/serve.ts`,
		url: `http://localhost:${SITE_PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		stdout: "ignore",
		stderr: "pipe",
	},
});
