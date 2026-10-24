import { ORPCError, os } from "@orpc/server";
import { member, setting } from "@vauly/db/schema/vault";
import { and, eq, sql } from "drizzle-orm";

import type { Context } from "./context";

export const o = os.$context<Context>();

export const publicProcedure = o;

const requireAuth = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}
	return next({
		context: {
			session: context.session,
		},
	});
});

export const protectedProcedure = publicProcedure.use(requireAuth);

/** The setting that, while it's "1", has every member set up two-step login first. */
export const REQUIRE_TWO_STEP = "require_two_step";

/** Whether the workspace requires two-step login, as a column of any query. */
export const twoStepPolicy = sql<number>`exists (select 1 from ${setting} where ${and(eq(setting.key, REQUIRE_TWO_STEP), eq(setting.value, "1"))})`;

/** What a member without two-step login gets while their workspace requires it. */
export const TWO_STEP_REQUIRED =
	"Your workspace requires two-step login. Set it up to open your vaults.";

/**
 * A signed-in person who has finished registering their keys, and whether their
 * workspace requires two-step login, read in the same query.
 */
export const findMember = o.middleware(async ({ context, next }) => {
	if (!context.session?.user) throw new ORPCError("UNAUTHORIZED");
	const [row] = await context.db
		.select({
			member,
			required: twoStepPolicy,
		})
		.from(member)
		.where(eq(member.userId, context.session.user.id));
	if (!row) {
		throw new ORPCError("FORBIDDEN", {
			message: "Not a member of this workspace",
		});
	}
	return next({
		context: {
			session: context.session,
			member: row.member,
			userId: row.member.userId,
			twoStepRequired: Boolean(row.required),
		},
	});
});

/**
 * Refuses a member without two-step login while their workspace requires it: a 403,
 * as a 401 would sign them out. Everything a member does goes through this, but what
 * setupProcedure lists.
 */
export const requireTwoStep = o
	.$context<{
		member: { totpSecret: string | null };
		twoStepRequired: boolean;
	}>()
	.middleware(async ({ context, next }) => {
		if (context.twoStepRequired && context.member.totpSecret === null) {
			throw new ORPCError("TWO_STEP_REQUIRED", {
				status: 403,
				message: TWO_STEP_REQUIRED,
			});
		}
		return next();
	});

/**
 * Only for what a member needs to set up two-step login, and to unlock, which their
 * workspace may require first. Keep it to those: everything else is memberProcedure.
 * gate.test.ts lists what may use it.
 */
export const setupProcedure = protectedProcedure.use(findMember);

/** A signed-in person who has finished registering their keys. */
export const memberProcedure = setupProcedure.use(requireTwoStep);

export const adminProcedure = memberProcedure.use(async ({ context, next }) => {
	if (context.member.role === "member") {
		throw new ORPCError("FORBIDDEN", {
			message: "Only owners and admins can do this",
		});
	}
	return next();
});
