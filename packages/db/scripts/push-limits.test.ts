import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { migrations } from "../src/bundled-migrations";

// 20261024041216_push_limits makes a session's device unique. A database that ran the
// table's first version, which could hold several devices on one session, must still
// take it: one failing migration keeps the Worker from serving at all.

function apply(db: Database, sql: string) {
	db.transaction(() => {
		for (const statement of sql.split("--> statement-breakpoint"))
			if (statement.trim()) db.run(statement);
	})();
}

test("push_limits keeps the newest device of a session that had several", () => {
	const db = new Database(":memory:");
	db.run("PRAGMA foreign_keys = ON");
	const at = migrations.findIndex((migration) =>
		migration.name.endsWith("_push_limits"),
	);
	expect(at).toBeGreaterThan(0);
	for (const migration of migrations.slice(0, at)) apply(db, migration.sql);

	db.run(
		"INSERT INTO user (id, name, email) VALUES ('usr_alex', 'Alex', 'alex@acme.test')",
	);
	for (const session of ["ses_phone", "ses_laptop"])
		db.run(
			"INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES (?, 0, ?, 0, 'usr_alex')",
			[session, session],
		);
	for (const [id, session] of [
		["psb_old", "ses_phone"],
		["psb_new", "ses_phone"],
		["psb_laptop", "ses_laptop"],
	] as const)
		db.run(
			"INSERT INTO push_subscription (id, user_id, session_id, endpoint, p256dh, auth) VALUES (?, 'usr_alex', ?, ?, 'key', 'auth')",
			[id, session, `https://fcm.googleapis.com/fcm/send/${id}`],
		);

	for (const migration of migrations.slice(at)) apply(db, migration.sql);
	expect(
		db.query("SELECT id FROM push_subscription ORDER BY id").all(),
	).toEqual([{ id: "psb_laptop" }, { id: "psb_new" }]);
	expect(() =>
		db.run(
			"INSERT INTO push_subscription (id, user_id, session_id, endpoint, p256dh, auth) VALUES ('psb_again', 'usr_alex', 'ses_phone', 'https://fcm.googleapis.com/fcm/send/again', 'key', 'auth')",
		),
	).toThrow("UNIQUE");
});
