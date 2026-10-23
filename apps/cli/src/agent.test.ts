import { describe, expect, test } from "bun:test";

import { type ItemFields, withValues } from "./agent";
import { findReferences } from "./references";

const item: ItemFields = {
	name: "Bank",
	secret: "example-password",
	username: "alex",
	fields: [
		{ label: "Account number", value: "12345678" },
		{ label: "PIN", value: "4711", hidden: true },
	],
};

describe("withValues", () => {
	test("puts custom fields in the environment, masking only hidden ones", () => {
		const env = {
			ACCOUNT: "vauly://itm_bank/fields/account%20NUMBER",
			PIN: "vauly://itm_bank/fields/PIN",
			PASSWORD: "vauly://itm_bank",
			VAULY_TOKEN: "vauly_agent_example",
		};
		const refs = findReferences(env);
		const { env: filled, secrets } = withValues(
			env,
			refs,
			new Map([["itm_bank", item]]),
		);
		expect(filled.ACCOUNT).toBe("12345678");
		expect(filled.PIN).toBe("4711");
		expect(filled.PASSWORD).toBe("example-password");
		expect(filled.VAULY_TOKEN).toBeUndefined();
		expect(secrets.sort()).toEqual(["4711", "example-password"]);
	});

	test("says which field is missing", () => {
		const env = { X: "vauly://itm_bank/fields/Security%20answer" };
		expect(() =>
			withValues(env, findReferences(env), new Map([["itm_bank", item]])),
		).toThrow("Bank has no field called Security answer.");
	});
});
