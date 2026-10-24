/// <reference types="bun" />

import { Database as Sqlite } from "bun:sqlite";
import type { Database } from "@vauly/db";
import { migrations } from "@vauly/db/bundled-migrations";
import { relations } from "@vauly/db/relations";
import { drizzle } from "drizzle-orm/bun-sqlite";

/**
 * vauly's schema on SQLite in memory, for the tests of code that queries the database.
 * Its queries run as D1 runs them; it has no `batch`.
 */
export function testDb() {
	const sqlite = new Sqlite(":memory:");
	sqlite.run("PRAGMA foreign_keys = ON");
	for (const migration of migrations) {
		for (const statement of migration.sql.split("--> statement-breakpoint")) {
			if (statement.trim()) sqlite.run(statement);
		}
	}
	const db = drizzle({ client: sqlite, relations }) as unknown as Database;
	return { sqlite, db };
}
