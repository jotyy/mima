import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// Not tests: `bun run store` makes the Chrome Web Store's pictures of the extension and
// saves them in apps/extension/store/. It fills the e2e stack with the example team and
// photographs the real extension; the promo tiles come from the website, which
// store/tiles.spec.ts serves itself.
export default defineConfig({
	...base,
	testDir: "./store",
	timeout: 600_000,
	reporter: "list",
});
