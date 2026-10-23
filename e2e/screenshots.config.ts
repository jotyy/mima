import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// Not tests: `bun run screenshots` fills the e2e stack with an example team and saves the
// pictures used by the README, the docs and the website into docs/images.
export default defineConfig({
	...base,
	testDir: "./screenshots",
	reporter: "list",
	use: {
		...base.use,
		deviceScaleFactor: 2,
		viewport: { width: 1200, height: 750 },
	},
});
