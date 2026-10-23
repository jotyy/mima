import { createAuth as createConfiguredAuth } from "@vauly/auth";
import { createDb, type Database } from "@vauly/db";

import { ENV } from "./env.server";

export function getDb(): Database {
	return createDb(ENV);
}
export async function createAuth(database?: Database) {
	return createConfiguredAuth(ENV, database ?? (await getDb()));
}
