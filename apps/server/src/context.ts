import type { Context as ApiContext } from "@vauly/api/context";
import type { Context as HonoContext } from "hono";

import { isDemo } from "./demo";
import { ENV } from "./env.server";
import { createAuth, getDb, prepare } from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

const MB = 1024 * 1024;

/** A size in MB from a setting, or the default when it's unset or isn't a number. */
const megabytes = (value: string | undefined, fallback: number) => {
	const number = Number(value);
	return value?.trim() && Number.isFinite(number) && number >= 0
		? Math.floor(number * MB)
		: fallback * MB;
};

/**
 * 10 MB a file and 200 MB in all, unless FILES_MAX_MB or FILES_TOTAL_MB say otherwise:
 * D1's free plan holds 500 MB a database, and files take a third more stored. The demo,
 * which everyone shares, takes small files only.
 */
const fileLimits = () =>
	isDemo()
		? { maxFileBytes: MB, maxTotalBytes: 10 * MB }
		: {
				maxFileBytes: megabytes(ENV.FILES_MAX_MB, 10),
				maxTotalBytes: megabytes(ENV.FILES_TOTAL_MB, 200),
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
		files: fileLimits(),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
