import { migrations } from "./bundled-migrations";

/**
 * Brings the database up to date with the migrations bundled into the Worker. A deploy
 * from the Deploy to Cloudflare button has no step that runs them, so the Worker applies
 * whatever is missing before it serves. They're recorded in the table and shape Alchemy
 * uses, so a database that Alchemy migrated is already current here.
 *
 * Each migration runs in one D1 batch with its record, so it lands whole or not at all.
 * When two Workers start at once, the second batch fails on tables that already exist and
 * rolls back; the next request finds everything applied.
 */
export async function migrate(d1: D1Database) {
	await d1
		.prepare(
			"CREATE TABLE IF NOT EXISTS __alchemy_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric, name text, applied_at TEXT)",
		)
		.run();
	const { results } = await d1
		.prepare("SELECT name FROM __alchemy_migrations")
		.all<{ name: string }>();
	const applied = new Set(results.map((row) => row.name));

	for (const migration of migrations) {
		if (applied.has(migration.name)) continue;
		const statements = migration.sql
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim())
			.filter(Boolean);
		await d1.batch([
			...statements.map((statement) => d1.prepare(statement)),
			d1
				.prepare(
					"INSERT INTO __alchemy_migrations (hash, created_at, name, applied_at) VALUES (?, ?, ?, datetime('now'))",
				)
				.bind(migration.hash, createdAt(migration.name), migration.name),
		]);
	}
}

/** The time in a migration's `YYYYMMDDhhmmss_` prefix, in milliseconds, as Alchemy stores it. */
function createdAt(name: string) {
	const stamp = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name);
	if (!stamp) return null;
	const [, year, month, day, hour, minute, second] = stamp.map(Number);
	return Date.UTC(
		year ?? 0,
		(month ?? 1) - 1,
		day ?? 1,
		hour ?? 0,
		minute ?? 0,
		second ?? 0,
	);
}
