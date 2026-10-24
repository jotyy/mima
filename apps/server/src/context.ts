import type { Context as ApiContext } from "@vauly/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import { createAuth, getDb, notifier, prepare } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const db = getDb();
	const origin = new URL(context.req.url).origin;
	const waitUntil = (promise: Promise<unknown>) =>
		context.executionCtx.waitUntil(promise);
	const auth = await createAuth(origin, db, waitUntil);
	const headers = context.req.raw.headers;
	const session = await auth.api.getSession({ headers });
	return {
		db,
		session,
		auth,
		headers,
		secret: await prepare(),
		setupCode: ENV.SETUP_CODE || undefined,
		notify: notifier(origin, db, waitUntil),
		localPush: Boolean(ENV.E2E_RESET_TOKEN),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
