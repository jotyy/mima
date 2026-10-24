import { describe, expect, test } from "bun:test";

import { closedInDemo } from "./demo";
import { appRouter } from "./routers/index";

describe("closedInDemo", () => {
	test("names procedures that exist", () => {
		for (const path of Object.keys(closedInDemo)) {
			const procedure = path
				.split(".")
				.reduce<unknown>(
					(node, key) => (node as Record<string, unknown> | undefined)?.[key],
					appRouter,
				);
			expect(procedure, path).toBeDefined();
		}
	});

	test("keeps notifications off, since every visitor is the same person", () => {
		expect(closedInDemo["push.subscribe"]).toContain("Notifications are off");
		expect(closedInDemo["push.publicKey"]).toContain("Notifications are off");
	});
});
