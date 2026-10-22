import { member } from "@mima/db/schema/vault";
import { ORPCError, os } from "@orpc/server";
import { eq } from "drizzle-orm";

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

/** A signed-in person who has finished registering their keys. */
export const memberProcedure = protectedProcedure.use(
	async ({ context, next }) => {
		const [row] = await context.db
			.select()
			.from(member)
			.where(eq(member.userId, context.session.user.id));
		if (!row) {
			throw new ORPCError("FORBIDDEN", {
				message: "Not a member of this workspace",
			});
		}
		return next({ context: { member: row, userId: row.userId } });
	},
);

export const adminProcedure = memberProcedure.use(async ({ context, next }) => {
	if (context.member.role === "member") {
		throw new ORPCError("FORBIDDEN", {
			message: "Only owners and admins can do this",
		});
	}
	return next();
});
