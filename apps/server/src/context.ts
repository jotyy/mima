import type { Context as ApiContext } from "@vauly/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb, prepare } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const db = getDb();
	const auth = await createAuth(new URL(context.req.url).origin, db);
	const headers = context.req.raw.headers;
	const session = await auth.api.getSession({ headers });
	return {
		db,
		session,
		auth,
		headers,
		secret: await prepare(),
		setupCode: ENV.SETUP_CODE || undefined,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
