import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The migrations in drizzle-kit's layout (`{timestamp}_{name}/migration.sql`), keyed the
 * way Alchemy records them: the directory name, sorted, with the sha256 of the SQL.
 */
export async function readMigrations(dir: string) {
	const entries = await readdir(dir, { withFileTypes: true });
	const names = entries
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
	return Promise.all(
		names.map(async (name) => {
			const sql = await readFile(path.join(dir, name, "migration.sql"), "utf8");
			const hash = createHash("sha256").update(sql).digest("hex");
			return { name, hash, sql };
		}),
	);
}
