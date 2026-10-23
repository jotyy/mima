import { ORPCError } from "@orpc/server";
import type { Hono } from "hono";

import { resetDatabase } from "./e2e-reset";
import { ENV } from "./env.server";
import { createAuth, getDb, prepare } from "./services";

/**
 * The demo at demo.vauly.app: one account every visitor shares, put back on the hour to
 * the example team it started with. A stack is the demo only when it was deployed with
 * DEMO_TOKEN, which nothing else sets.
 */
export const isDemo = () => Boolean(ENV.DEMO_TOKEN);

/**
 * What the demo won't do: anything that would lock the next visitor out, change what
 * everyone sees the account called, or publish something on a public link.
 */
const closed: Record<string, string> = {
	"account.changePassword":
		"The demo keeps its master password, so the next visitor can sign in.",
	"account.beginTwoStep":
		"Two-step login stays off in the demo, so the next visitor can sign in.",
	"account.confirmTwoStep":
		"Two-step login stays off in the demo, so the next visitor can sign in.",
	"account.updateProfile": "The demo account keeps its name.",
	"account.renameWorkspace": "The demo workspace keeps its name.",
	"links.create":
		"Share links are off in the demo, since anyone could open them.",
	"account.deleteAccount":
		"The demo account stays, so the next visitor can sign in.",
	"members.transferOwnership": "The demo workspace keeps its owner.",
};

/** Turns away the procedures the demo keeps closed, before they run. */
export async function demoGuard<T>({
	path,
	next,
}: {
	path: readonly string[];
	next: () => Promise<T>;
}) {
	const reason = isDemo() ? closed[path.join(".")] : undefined;
	if (reason) throw new ORPCError("FORBIDDEN", { message: reason });
	return next();
}

// Parents before children, the order the foreign keys need for putting rows back.
// Sessions aren't kept: the hour signs everyone out.
const tables = [
	"user",
	"account",
	"verification",
	"setting",
	"member",
	"invite",
	"vault",
	"vault_access",
	"item",
	"favorite",
	"share_link",
	"agent",
	"agent_grant",
	"access_request",
	"event",
];

/** Keeps the database as it is now as what the demo goes back to. */
async function snapshot(db: D1Database) {
	await db.exec(
		"CREATE TABLE IF NOT EXISTS demo_snapshot (name TEXT PRIMARY KEY, rows TEXT NOT NULL)",
	);
	const copies = await db.batch(
		tables.map((table) => db.prepare(`SELECT * FROM "${table}"`)),
	);
	await db.batch(
		tables.map((table, index) =>
			db
				.prepare(
					"INSERT OR REPLACE INTO demo_snapshot (name, rows) VALUES (?, ?)",
				)
				.bind(table, JSON.stringify(copies[index]?.results ?? [])),
		),
	);
}

/** Puts the demo back as the snapshot has it, in one transaction. Without one, it waits. */
export async function restore(db: D1Database) {
	const saved = await db
		.prepare("SELECT name, rows FROM demo_snapshot")
		.all<{ name: string; rows: string }>()
		.catch(() => null);
	if (!saved?.results.length) return false;
	const rows = new Map(
		saved.results.map((row) => [
			row.name,
			JSON.parse(row.rows) as Record<string, unknown>[],
		]),
	);
	const statements = [
		db.prepare('DELETE FROM "session"'),
		...[...tables]
			.reverse()
			.map((table) => db.prepare(`DELETE FROM "${table}"`)),
	];
	for (const table of tables) {
		for (const row of rows.get(table) ?? []) {
			const columns = Object.keys(row);
			statements.push(
				db
					.prepare(
						`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
					)
					.bind(...columns.map((column) => row[column] ?? null)),
			);
		}
	}
	await db.batch(statements);
	return true;
}

/**
 * The demo's own routes, mounted ahead of Better Auth's: a token-held snapshot and reset,
 * and sessions that stay private, since every visitor signs in as the same person.
 */
export function mountDemo(app: Hono) {
	const allowed = (header: string | undefined) => header === ENV.DEMO_TOKEN;

	// Empties it, so `bun run demo:seed` in e2e/ can fill it with the example team again.
	app.post("/__demo/wipe", async (c) => {
		if (!allowed(c.req.header("x-demo-token"))) return c.text("Forbidden", 403);
		await prepare();
		await resetDatabase(getDb());
		return c.text("OK");
	});
	app.post("/__demo/snapshot", async (c) => {
		if (!allowed(c.req.header("x-demo-token"))) return c.text("Forbidden", 403);
		await prepare();
		await snapshot(ENV.DB);
		return c.text("OK");
	});
	app.post("/__demo/reset", async (c) => {
		if (!allowed(c.req.header("x-demo-token"))) return c.text("Forbidden", 403);
		await prepare();
		return (await restore(ENV.DB))
			? c.text("OK")
			: c.text("No snapshot yet", 409);
	});

	// Each visitor sees only their own session, and can't end anyone else's.
	app.get("/api/auth/list-sessions", async (c) => {
		const auth = await createAuth(new URL(c.req.url).origin);
		const current = await auth.api.getSession({ headers: c.req.raw.headers });
		return c.json(current ? [current.session] : []);
	});
	app.on(
		"POST",
		[
			"/api/auth/revoke-session",
			"/api/auth/revoke-sessions",
			"/api/auth/revoke-other-sessions",
		],
		(c) =>
			c.json(
				{ message: "In the demo, each visitor's session is their own." },
				403,
			),
	);
}
