import { describe, expect, test } from "bun:test";

import { describeEvent } from "./describe-event";
import type { Item, VaultEvent } from "./vault-data";

// A custom field reaches the server only as its ID; the activity log finds its label in
// the decrypted item.

const item = {
	id: "itm_1",
	name: "Bank",
	fields: [{ id: "ab12cd34", label: "PIN", value: "4711", hidden: true }],
} as Item;

const describe_ = (detail: string | null) =>
	describeEvent(
		{
			id: "evt_1",
			action: "revealed",
			actorName: "Alex",
			itemId: "itm_1",
			detail,
		} as VaultEvent,
		{
			items: new Map([["itm_1", item]]),
			vaults: new Map(),
			agents: new Map(),
			members: new Map(),
		},
	).verb;

describe("revealing and copying", () => {
	test("a custom field is named from the item", () => {
		expect(describe_("field:ab12cd34")).toBe("revealed the PIN of");
	});

	test("one that's gone, or from before IDs, is a custom field", () => {
		expect(describe_("field:zz99zz99")).toBe("revealed a custom field of");
		expect(describe_("field")).toBe("revealed a custom field of");
	});

	test("the fields every item has keep their names", () => {
		expect(describe_("secret")).toBe("revealed the password of");
		expect(describe_(null)).toBe("revealed the password of");
		expect(describe_("earlier password")).toBe(
			"revealed the earlier password of",
		);
	});
});
