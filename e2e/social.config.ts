import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// Not tests: `bun run social` makes the images for launching vauly on social media and
// saves them in brand/social/. It photographs the app, the CLI and the extension with
// the example team on the e2e stack, and lays them out on the website's own pages.
export default defineConfig({
	...base,
	testDir: "./social",
	timeout: 600_000,
	reporter: "list",
});
