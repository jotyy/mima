import { describe, expect, test } from "bun:test";

import {
	createMasker,
	findReferences,
	parseEnvFile,
	parseReference,
} from "./references";

describe("references", () => {
	test("parses item references and fields", () => {
		expect(parseReference("vauly://itm_abc123")).toEqual({
			itemId: "itm_abc123",
			field: "secret",
		});
		expect(parseReference("vauly://itm_abc123/password")).toEqual({
			itemId: "itm_abc123",
			field: "secret",
		});
		expect(parseReference("vauly://itm_abc123/username")).toEqual({
			itemId: "itm_abc123",
			field: "username",
		});
		expect(parseReference("postgres://localhost")).toBeNull();
		expect(parseReference("vauly://not-an-item")).toBeNull();
	});

	test("finds references among environment values", () => {
		const refs = findReferences({
			A: "vauly://itm_one",
			B: "plain",
			C: "vauly://itm_two/url",
		});
		expect(refs.map((r) => r.name)).toEqual(["A", "C"]);
	});

	test("reads .env files", () => {
		const env = parseEnvFile(
			'# comment\nDATABASE_URL=vauly://itm_db\nexport NAME="vauly app"\nEMPTY=\nPORT=3000 # inline\n',
		);
		expect(env).toEqual({
			DATABASE_URL: "vauly://itm_db",
			NAME: "vauly app",
			EMPTY: "",
			PORT: "3000",
		});
	});
});

describe("masker", () => {
	test("hides secrets, including ones split across chunks", () => {
		const masker = createMasker(["s3cret-value"]);
		const out =
			masker.push("db at s3cr") + masker.push("et-value ok\n") + masker.flush();
		expect(out).toBe("db at <hidden> ok\n");
		expect(out).not.toContain("s3cret");
	});

	test("leaves output alone when there is nothing to hide", () => {
		const masker = createMasker([]);
		expect(masker.push("hello") + masker.flush()).toBe("hello");
	});
});
