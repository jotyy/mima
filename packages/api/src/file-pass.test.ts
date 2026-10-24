/// <reference types="bun" />

import { expect, test } from "bun:test";

import { readPass, signPass } from "./file-pass";

const secret = "a-server-secret-for-tests-only-0123456789";
const pass = {
	agentId: "agt_one",
	grantId: "grt_one",
	fileId: "att_one",
	until: 2_000_000_000_000,
};
const now = pass.until - 60_000;

test("a pass opens for its agent, grant and file until it expires", async () => {
	const token = await signPass(secret, pass);
	expect(await readPass(secret, "agt_one", token, now)).toEqual({
		fileId: "att_one",
		grantId: "grt_one",
	});
	expect(await readPass(secret, "agt_one", token, pass.until + 1)).toBeNull();
});

test("another agent, another secret or a changed pass gets nothing", async () => {
	const token = await signPass(secret, pass);
	expect(await readPass(secret, "agt_two", token, now)).toBeNull();
	expect(await readPass(`${secret}x`, "agt_one", token, now)).toBeNull();
	const [, grant, until, signature] = token.split(".");
	for (const changed of [
		`att_two.${grant}.${until}.${signature}`,
		`att_one.grt_two.${until}.${signature}`,
		`att_one.${grant}.${Number(until) + 1}.${signature}`,
		`att_one.${grant}.${until}.${signature?.slice(0, -2)}AA`,
		`att_one.${grant}.later.${signature}`,
		`att_one.${grant}`,
		"",
	]) {
		expect(await readPass(secret, "agt_one", changed, now)).toBeNull();
	}
});
