import { defineConfig } from "@playwright/test";

import base from "./playwright.config";

// Not tests: `.github/workflows/action.yml` seeds the test stack with this before it
// uses vauly's GitHub Action, against the same stack the e2e suite starts.
export default defineConfig({ ...base, testDir: "./action" });
