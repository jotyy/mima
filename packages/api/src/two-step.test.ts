/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { type AnyProcedure, call } from "@orpc/server";
import { parseTotp, totpCode } from "@vauly/crypto";
import { member } from "@vauly/db/schema/vault";
import { eq } from "drizzle-orm";

import type { Context } from "./context";
import { appRouter } from "./routers/index";
import { testDb } from "./test-db";

// Turning two-step login on ends the sessions that gave the password alone, and a reset
// ends them all. Of two setups at once, only one takes effect: a setup key slipped in by
// a request that read the account before can't replace the one just turned on.

const SESSION_ENDS = 4_102_444_800_000;

function workspace() {
	const { sqlite, db } = testDb();
	// D1 runs a batch's statements in one transaction; here they run in order.
	Object.assign(db, {
		batch: async (statements: readonly PromiseLike<unknown>[]) => {
			const results: unknown[] = [];
			for (const statement of statements) results.push(await statement);
			return results;
		},
	});
	for (const [id, name, role] of [
		["usr_alex", "Alex", "owner"],
		["usr_mei", "Mei", "member"],
	]) {
		sqlite.run(
			`INSERT INTO user (id, name, email) VALUES ('${id}', '${name}', '${id}@acme.test')`,
		);
		sqlite.run(
			`INSERT INTO member (user_id, role, kdf_salt, kdf, kdf_iterations, public_key, encrypted_private_key) VALUES ('${id}', '${role}', 'S', 'pbkdf2', 600000, 'pk', 'sk')`,
		);
	}
	for (const [id, userId] of [
		["ses_alex", "usr_alex"],
		["ses_mei_here", "usr_mei"],
		["ses_mei_there", "usr_mei"],
	]) {
		sqlite.run(
			`INSERT INTO session (id, token, expires_at, updated_at, user_id) VALUES ('${id}', 'token-${id}', ${SESSION_ENDS}, 0, '${userId}')`,
		);
	}
	const as = (userId: string, sessionId: string) =>
		({
			session: {
				user: { id: userId, name: userId, email: `${userId}@acme.test` },
				session: { id: sessionId },
			},
			db,
			auth: {},
			headers: new Headers(),
			secret: "test-secret-that-is-long-enough",
			files: { maxFileBytes: 1024, maxTotalBytes: 4096 },
			notify: () => {},
		}) as unknown as Context;
	const sessions = () =>
		(
			sqlite.query("SELECT id FROM session ORDER BY id").all() as {
				id: string;
			}[]
		).map((row) => row.id);
	const setups = () =>
		(
			sqlite
				.query("SELECT count(*) AS n FROM event WHERE detail = ?")
				.get("two-step login on") as { n: number }
		).n;
	const mei = async () =>
		(await db.select().from(member).where(eq(member.userId, "usr_mei")))[0];
	return { as, sessions, setups, mei };
}

async function codeFor(secret: string) {
	const config = parseTotp(secret);
	if (!config) throw new Error("bad setup key");
	return totpCode(config);
}

/** Turns it on for Mei, from her session here. */
async function turnOn(context: Context) {
	const { secret } = await call(appRouter.account.beginTwoStep, undefined, {
		context,
	});
	await call(
		appRouter.account.confirmTwoStep,
		{ code: await codeFor(secret) },
		{ context },
	);
	return secret;
}

/** The handler alone, given what an earlier read of Mei's account found. */
function handle(
	procedure: AnyProcedure,
	context: Context,
	stale: object,
	input?: unknown,
) {
	return procedure["~orpc"].handler({
		context: {
			...context,
			member: stale,
			userId: "usr_mei",
			twoStepRequired: true,
		},
		input,
		path: [],
		procedure,
		signal: undefined,
		lastEventId: undefined,
		errors: {},
	} as never);
}

describe("two-step login and sessions", () => {
	test("turning it on signs out the person's other sessions, and only theirs", async () => {
		const { as, sessions, setups } = workspace();
		await turnOn(as("usr_mei", "ses_mei_here"));
		expect(sessions()).toEqual(["ses_alex", "ses_mei_here"]);
		expect(setups()).toBe(1);
	});

	test("a reset signs them out everywhere", async () => {
		const { as, sessions } = workspace();
		await turnOn(as("usr_mei", "ses_mei_here"));
		await call(
			appRouter.members.resetTwoStep,
			{ userId: "usr_mei" },
			{ context: as("usr_alex", "ses_alex") },
		);
		expect(sessions()).toEqual(["ses_alex"]);
	});

	test("a setup key slipped in after it's on can't replace it", async () => {
		const { as, sessions, setups, mei } = workspace();
		const context = as("usr_mei", "ses_mei_here");
		const secret = await turnOn(context);
		const before = await mei();
		const theirs = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
		// Requests that read the account before it was turned on.
		const read = { ...before, totpSecret: null, totpPending: theirs };

		const started = handle(appRouter.account.beginTwoStep, context, read);
		await expect(started).rejects.toThrow("Two-step login is on already");
		expect((await mei())?.totpPending).toBeNull();

		const confirmed = handle(appRouter.account.confirmTwoStep, context, read, {
			code: await codeFor(theirs),
		});
		await expect(confirmed).rejects.toMatchObject({ code: "CONFLICT" });
		expect((await mei())?.totpSecret).toBe(secret);
		expect((await mei())?.recoveryCodes).toEqual(before?.recoveryCodes);
		expect(setups()).toBe(1);
		expect(sessions()).toEqual(["ses_alex", "ses_mei_here"]);
	});
});
