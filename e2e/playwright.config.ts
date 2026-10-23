import { defineConfig, devices } from "@playwright/test";

// The suite starts its own stack (stage `e2e`, ports 3100/3101, its own D1) so it never
// touches the database behind `bun run dev`. Each spec file resets it first.
//
// With VAULY_E2E_ONE_WORKER set it runs against vauly as the Deploy to Cloudflare button
// deploys it instead: one Worker for the app and the API, from the root wrangler.jsonc,
// under `wrangler dev` on port 3102 with its own local D1.
//
// VAULY_E2E_PORT moves all three ports up together (the API on it, the app on the next,
// one Worker on the one after), so checkouts side by side can each run their own suite.
const oneWorker = Boolean(process.env.VAULY_E2E_ONE_WORKER);
const base = Number(process.env.VAULY_E2E_PORT ?? 3100);
export const API_PORT = oneWorker ? base + 2 : base;
export const WEB_PORT = oneWorker ? base + 2 : base + 1;
export const RESET_TOKEN =
	process.env.VAULY_E2E_RESET_TOKEN ?? "vauly-e2e-local";
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
	webServer: oneWorker
		? {
				command: `VITE_SERVER_URL= bun run build && bunx wrangler dev --port ${WEB_PORT} --var E2E_RESET_TOKEN:${RESET_TOKEN} --persist-to .wrangler/e2e`,
				cwd: "..",
				url: `http://localhost:${WEB_PORT}`,
				reuseExistingServer: !process.env.CI,
				timeout: 300_000,
				stdout: "ignore",
				stderr: "pipe",
			}
		: {
				command: "bun run dev --stage e2e",
				cwd: "../packages/infra",
				url: `http://localhost:${WEB_PORT}`,
				env: {
					VAULY_API_PORT: String(API_PORT),
					VAULY_WEB_PORT: String(WEB_PORT),
					VAULY_E2E_RESET_TOKEN: RESET_TOKEN,
				},
				reuseExistingServer: !process.env.CI,
				timeout: 360_000,
				stdout: "ignore",
				stderr: "pipe",
			},
});
