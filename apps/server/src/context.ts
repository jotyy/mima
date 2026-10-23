import type { Context as ApiContext } from "@mima/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const db = getDb();
	const auth = await createAuth(db);
	const headers = context.req.raw.headers;
	const session = await auth.api.getSession({ headers });
	return {
		db,
		session,
		auth,
		headers,
		secret: ENV.BETTER_AUTH_SECRET,
		setupCode: ENV.SETUP_CODE || undefined,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
