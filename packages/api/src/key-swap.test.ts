/// <reference types="bun" />

import { type SQLQueryBindings, Database as Sqlite } from "bun:sqlite";
import { beforeEach, expect, test } from "bun:test";
import { createDb } from "@vauly/db";
import { migrations } from "@vauly/db/bundled-migrations";

import { type NewKeys, signOutOthersAfter, swapKeys } from "./key-swap";

// The statements the swaps run, on SQLite with vauly's schema: two requests that began
// from the same keys, their batches run one after the other, the way D1 runs two batches
// that arrive together.

const db = createDb({ DB: {} as D1Database });
let sqlite: Sqlite;

type Statement = { toSQL(): { sql: string; params: unknown[] } };
const exec = (statement: Statement) => {
	const { sql, params } = statement.toSQL();
	return sqlite.query(sql).all(...(params as SQLQueryBindings[]));
};
/** A batch: its statements in one transaction, as D1 runs it. */
const batch = (statements: readonly Statement[]) =>
	sqlite.transaction(() => statements.map(exec))();

const argon2id = (salt: string): NewKeys => ({
	kdfSalt: salt,
	kdf: "argon2id",
	kdfIterations: 600_000,
	kdfPasses: 3,
	kdfMemory: 65_536,
	encryptedPrivateKey: `sealed under ${salt}`,
});

const keysNow = () =>
	sqlite
		.query(
			"SELECT kdf_salt AS salt, kdf, kdf_passes AS passes, encrypted_private_key AS sealed FROM member",
		)
		.get();
const hashNow = () =>
	(sqlite.query("SELECT password FROM account").get() as { password: string })
		.password;
const sessionsNow = () =>
	(
		sqlite.query("SELECT id FROM session ORDER BY id").all() as { id: string }[]
	).map((row) => row.id);

const swap = (from: { kdfSalt: string; kdf?: "pbkdf2" }, salt: string) =>
	swapKeys(db, {
		userId: "usr_alex",
		accountId: "acc_alex",
		from,
		passwordHash: `hash for ${salt}`,
		keys: argon2id(salt),
	});

beforeEach(() => {
	sqlite = new Sqlite(":memory:");
	for (const migration of migrations) {
		for (const statement of migration.sql.split("--> statement-breakpoint")) {
			if (statement.trim()) sqlite.run(statement);
		}
	}
	sqlite.run(
		"INSERT INTO user (id, name, email) VALUES ('usr_alex', 'Alex', 'alex@acme.test')",
	);
	sqlite.run(
		"INSERT INTO account (id, account_id, provider_id, user_id, password, updated_at) VALUES ('acc_alex', 'usr_alex', 'credential', 'usr_alex', 'hash for S0', 0)",
	);
	sqlite.run(
		"INSERT INTO member (user_id, role, kdf_salt, kdf, kdf_iterations, public_key, encrypted_private_key) VALUES ('usr_alex', 'owner', 'S0', 'pbkdf2', 600000, 'public key', 'sealed under S0')",
	);
	for (const id of ["ses_laptop", "ses_phone"]) {
		sqlite.run(
			`INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('${id}', 0, '${id}', 0, 'usr_alex')`,
		);
	}
});

test("of two swaps from the same keys, the first wins and the second changes nothing", () => {
	const [, first] = batch(swap({ kdfSalt: "S0" }, "S1"));
	const [, second] = batch(swap({ kdfSalt: "S0" }, "S2"));
	expect(first).toHaveLength(1);
	expect(second).toHaveLength(0);
	expect(keysNow()).toEqual({
		salt: "S1",
		kdf: "argon2id",
		passes: 3,
		sealed: "sealed under S1",
	});
	// The auth hash went with the keys that won, never with the other request's.
	expect(hashNow()).toBe("hash for S1");
});

test("a move from PBKDF2 can't undo a password change that landed first", () => {
	batch(swap({ kdfSalt: "S0" }, "S1"));
	const [, moved] = batch(swap({ kdfSalt: "S0", kdf: "pbkdf2" }, "S2"));
	expect(moved).toHaveLength(0);
	expect(hashNow()).toBe("hash for S1");
	expect(keysNow()).toMatchObject({ salt: "S1" });
});

test("a move only happens while the account is on PBKDF2", () => {
	sqlite.run("UPDATE member SET kdf = 'argon2id', kdf_passes = 3");
	const [, moved] = batch(swap({ kdfSalt: "S0", kdf: "pbkdf2" }, "S1"));
	expect(moved).toHaveLength(0);
	expect(hashNow()).toBe("hash for S0");
});

test("only the swap that won signs the other sessions out", () => {
	const signOut = (sessionId: string, kdfSalt: string) =>
		signOutOthersAfter(db, { userId: "usr_alex", sessionId, kdfSalt });
	batch([...swap({ kdfSalt: "S0" }, "S1"), signOut("ses_laptop", "S1")]);
	expect(sessionsNow()).toEqual(["ses_laptop"]);
	// The phone signs in again; a change it started from the old keys loses, and signs
	// nobody out.
	sqlite.run(
		"INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('ses_phone', 0, 'ses_phone', 0, 'usr_alex')",
	);
	batch([...swap({ kdfSalt: "S0" }, "S2"), signOut("ses_phone", "S2")]);
	expect(sessionsNow()).toEqual(["ses_laptop", "ses_phone"]);
	expect(hashNow()).toBe("hash for S1");
});
