/// <reference types="bun" />

import { Database as Sqlite } from "bun:sqlite";
import { expect, test } from "bun:test";
import { migrations } from "@vauly/db/bundled-migrations";

// The one-off migration that clears grants and open requests left on items in vaults their
// agent's owner can't open, run on SQLite with vauly's schema.

const run = (sqlite: Sqlite, sql: string) => {
	for (const statement of sql.split("--> statement-breakpoint")) {
		if (statement.trim()) sqlite.run(statement);
	}
};

test("agents keep what their owner can open, and lose the rest", () => {
	const sqlite = new Sqlite(":memory:");
	const last = migrations.findIndex((migration) =>
		migration.name.endsWith("_agents_outside_vault"),
	);
	expect(last).toBeGreaterThan(0);
	for (const migration of migrations.slice(0, last)) run(sqlite, migration.sql);

	for (const [id, name] of [
		["usr_alex", "Alex"],
		["usr_mei", "Mei"],
	]) {
		sqlite.run(
			`INSERT INTO user (id, name, email) VALUES ('${id}', '${name}', '${id}@acme.test')`,
		);
		sqlite.run(
			`INSERT INTO member (user_id, role, kdf_salt, kdf, kdf_iterations, public_key, encrypted_private_key) VALUES ('${id}', 'member', 'S', 'pbkdf2', 600000, 'pk', 'sk')`,
		);
	}
	// Alex's private vault, and a vault both can open.
	for (const id of ["vlt_alex", "vlt_shared"]) {
		sqlite.run(
			`INSERT INTO vault (id, encrypted_meta, created_by) VALUES ('${id}', 'm', 'usr_alex')`,
		);
	}
	for (const [vault, user] of [
		["vlt_alex", "usr_alex"],
		["vlt_shared", "usr_alex"],
		["vlt_shared", "usr_mei"],
	]) {
		sqlite.run(
			`INSERT INTO vault_access (vault_id, user_id, wrapped_key, granted_by) VALUES ('${vault}', '${user}', 'k', 'usr_alex')`,
		);
	}
	for (const [item, vault] of [
		["itm_moved", "vlt_alex"],
		["itm_shared", "vlt_shared"],
	]) {
		sqlite.run(
			`INSERT INTO item (id, vault_id, wrapped_key, data, created_by, updated_by, updated_at) VALUES ('${item}', '${vault}', 'k', 'd', 'usr_alex', 'usr_alex', 0)`,
		);
	}
	sqlite.run(
		"INSERT INTO agent (id, name, kind, owner_id, public_key, secret_hash) VALUES ('agt_mei', 'Mei''s agent', 'cli', 'usr_mei', 'pk', 'h')",
	);
	for (const item of ["itm_moved", "itm_shared"]) {
		sqlite.run(
			`INSERT INTO agent_grant (id, agent_id, item_id, wrapped_key, granted_by) VALUES ('grt_${item}', 'agt_mei', '${item}', 'k', 'usr_mei')`,
		);
		sqlite.run(
			`INSERT INTO access_request (id, agent_id, item_id, command) VALUES ('req_${item}', 'agt_mei', '${item}', 'deploy')`,
		);
	}

	run(sqlite, migrations[last]?.sql ?? "");
	const ids = (table: string) =>
		(
			sqlite.query(`SELECT item_id AS id FROM ${table} ORDER BY 1`).all() as {
				id: string;
			}[]
		).map((row) => row.id);
	expect(ids("agent_grant")).toEqual(["itm_shared"]);
	expect(ids("access_request")).toEqual(["itm_shared"]);
});
