/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { type AnyProcedure, call, isProcedure } from "@orpc/server";

import type { Context } from "./context";
import { findMember, REQUIRE_TWO_STEP, requireTwoStep } from "./index";
import { appRouter } from "./routers/index";
import { testDb } from "./test-db";

// Requiring two-step login is only as good as the routes it covers. This walks every
// procedure in the router. Each one is public, or for agents, which use their own token,
// as listed here; or it refuses a member without two-step login while their workspace
// requires it, but for the steps of setting it up. A route added later is refused
// unless it's added to a list.

/** What needs no member's session: these are open to anyone, or take an agent's token. */
const PUBLIC = [
	"account.invite",
	"account.prelogin",
	"account.register",
	"account.status",
	"healthCheck",
	"links.open",
	"links.peek",
];
const forAgents = (path: string) => path.startsWith("agent.");

/** What a member without two-step login may still call while their workspace requires it. */
const OPEN_FOR_SETUP = [
	"account.beginTwoStep",
	"account.confirmTwoStep",
	"account.me",
	"push.unsubscribe",
];

function walk(node: unknown, path: string[] = []): [string, AnyProcedure][] {
	if (isProcedure(node)) return [[path.join("."), node]];
	if (!node || typeof node !== "object") return [];
	return Object.entries(node).flatMap(([key, value]) =>
		walk(value, [...path, key]),
	);
}

const procedures = walk(appRouter);
const paths = procedures.map(([path]) => path).sort();
const uses = (procedure: AnyProcedure, middleware: unknown) =>
	(procedure["~orpc"].middlewares as unknown[]).includes(middleware);
const usingAll = (...middlewares: unknown[]) =>
	procedures
		.filter(([, procedure]) =>
			middlewares.every((middleware) => uses(procedure, middleware)),
		)
		.map(([path]) => path)
		.sort();
/** Everything else, which must refuse a member without two-step login. */
const gated = paths.filter(
	(path) =>
		!PUBLIC.includes(path) &&
		!forAgents(path) &&
		!OPEN_FOR_SETUP.includes(path),
);

function workspace(options: { required: boolean; twoStep: boolean }) {
	const { sqlite, db } = testDb();
	sqlite.run(
		"INSERT INTO user (id, name, email) VALUES ('usr_mei', 'Mei', 'mei@acme.test')",
	);
	sqlite.run(
		`INSERT INTO member (user_id, role, kdf_salt, kdf, kdf_iterations, public_key, encrypted_private_key, totp_secret) VALUES ('usr_mei', 'admin', 'S', 'pbkdf2', 600000, 'pk', 'sk', ${options.twoStep ? "'JBSWY3DPEHPK3PXP'" : "NULL"})`,
	);
	if (options.required) {
		sqlite.run(
			`INSERT INTO setting (key, value) VALUES ('${REQUIRE_TWO_STEP}', '1')`,
		);
	}
	return {
		session: {
			user: { id: "usr_mei", name: "Mei", email: "mei@acme.test" },
			session: { id: "ses_mei" },
		},
		db,
		auth: {},
		headers: new Headers(),
		secret: "test-secret-that-is-long-enough",
		files: { maxFileBytes: 1024, maxTotalBytes: 4096 },
		notify: () => {},
	} as unknown as Context;
}

/** The procedures that refuse this context for want of two-step login. */
async function refused(context: Context) {
	const paths: string[] = [];
	for (const [path, procedure] of procedures) {
		try {
			await call(procedure, {}, { context });
		} catch (error) {
			if ((error as { code?: string }).code === "TWO_STEP_REQUIRED") {
				paths.push(path);
			}
		}
	}
	return paths.sort();
}

describe("requiring two-step login", () => {
	test("covers every route but the public ones, the agents' and setting it up", () => {
		for (const path of [...PUBLIC, ...OPEN_FOR_SETUP]) {
			expect(paths).toContain(path);
		}
		expect(usingAll(requireTwoStep)).toEqual(gated);
		expect(
			usingAll(findMember).filter((path) => !gated.includes(path)),
		).toEqual([...OPEN_FOR_SETUP].sort());
	});

	test("refuses them all while it's required and the member hasn't set it up", async () => {
		expect(
			await refused(workspace({ required: true, twoStep: false })),
		).toEqual(gated);
	});

	test("refuses none once they've set it up, or while it isn't required", async () => {
		expect(await refused(workspace({ required: true, twoStep: true }))).toEqual(
			[],
		);
		expect(
			await refused(workspace({ required: false, twoStep: false })),
		).toEqual([]);
	});

	test("the agents' routes take an agent's token, not a member's session", async () => {
		const context = workspace({ required: false, twoStep: true });
		const agentRoutes = procedures.filter(([path]) => forAgents(path));
		expect(agentRoutes.length).toBeGreaterThan(0);
		for (const [path, procedure] of agentRoutes) {
			const error = await call(procedure, {}, { context }).catch(
				(caught: { code?: string }) => caught,
			);
			expect((error as { code?: string }).code, path).toBe("UNAUTHORIZED");
		}
	});

	test("an admin can't require it before setting it up themselves", async () => {
		const context = workspace({ required: false, twoStep: false });
		const error = await call(
			appRouter.members.setTwoStepPolicy,
			{ required: true },
			{ context },
		).catch((caught: Error) => caught);
		expect((error as Error).message).toContain(
			"Turn on two-step login for yourself first",
		);
	});
});
