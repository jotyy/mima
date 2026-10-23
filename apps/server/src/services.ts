import { createAuth as createConfiguredAuth } from "@vauly/auth";
import { createDb, type Database } from "@vauly/db";
import { migrate } from "@vauly/db/migrate";
import { setting } from "@vauly/db/schema/vault";
import { eq } from "drizzle-orm";

import { ENV } from "./env.server";

export function getDb(): Database {
	return createDb(ENV);
}

let ready: Promise<string> | undefined;

/**
 * Gets the database ready, once per Worker: applies any migration it's missing, then
 * settles the secret that signs sessions. Returns that secret. A failure is retried on
 * the next request.
 */
export function prepare(): Promise<string> {
	if (!ready) {
		ready = (async () => {
			await migrate(ENV.DB);
			return ENV.BETTER_AUTH_SECRET || (await storedSecret(getDb()));
		})();
		ready.catch(() => {
			ready = undefined;
		});
	}
	return ready;
}

/**
 * A deploy without BETTER_AUTH_SECRET, such as one from the Deploy to Cloudflare button,
 * makes a random one on first start and keeps it in the database. Whichever Worker writes
 * first wins; the rest read it back.
 */
async function storedSecret(db: Database) {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	await db
		.insert(setting)
		.values({ key: "auth_secret", value: btoa(String.fromCharCode(...bytes)) })
		.onConflictDoNothing();
	const [row] = await db
		.select({ value: setting.value })
		.from(setting)
		.where(eq(setting.key, "auth_secret"));
	if (!row) throw new Error("No auth secret in the database");
	return row.value;
}

/**
 * Better Auth for a request to `origin`. One Worker serving both the app and the API
 * needs no BETTER_AUTH_URL or CORS_ORIGIN: it is where the request went.
 */
export async function createAuth(origin: string, database?: Database) {
	return createConfiguredAuth(
		{
			BETTER_AUTH_SECRET: await prepare(),
			BETTER_AUTH_URL: ENV.BETTER_AUTH_URL || origin,
			CORS_ORIGIN: ENV.CORS_ORIGIN || origin,
		},
		database ?? getDb(),
	);
}
