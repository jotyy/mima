import type { Database as Sqlite } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@vauly/db";

import { testDb } from "../test-db";
import {
	DEVICE_LIMIT,
	normalEndpoint,
	saveSubscription,
} from "./subscriptions";

// The devices that get notifications, on vauly's schema in SQLite.

const keys = {
	p256dh:
		"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
	auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const fcm = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

let sqlite: Sqlite;
let db: Database;

function addSession(
	id: string,
	userId: string,
	expiresAt = Date.now() + 60_000,
) {
	sqlite.run(
		"INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES (?, ?, ?, 0, ?)",
		[id, expiresAt, id, userId],
	);
}

const devices = () =>
	sqlite
		.query(
			"SELECT user_id AS userId, session_id AS sessionId, endpoint FROM push_subscription ORDER BY session_id",
		)
		.all();

const save = (userId: string, sessionId: string, endpoint: string) =>
	saveSubscription(db, { userId, sessionId, endpoint, keys });

beforeEach(() => {
	({ sqlite, db } = testDb());
	for (const [id, name] of [
		["usr_alex", "Alex"],
		["usr_sam", "Sam"],
	] as const)
		sqlite.run("INSERT INTO user (id, name, email) VALUES (?, ?, ?)", [
			id,
			name,
			`${name.toLowerCase()}@acme.test`,
		]);
	addSession("ses_alex_laptop", "usr_alex");
	addSession("ses_alex_phone", "usr_alex");
	addSession("ses_sam", "usr_sam");
});

describe("saveSubscription", () => {
	test("one device per session: a new endpoint replaces the old one", async () => {
		expect(await save("usr_alex", "ses_alex_phone", fcm("first"))).toBe(
			"saved",
		);
		expect(await save("usr_alex", "ses_alex_phone", fcm("second"))).toBe(
			"saved",
		);
		expect(devices()).toEqual([
			{
				userId: "usr_alex",
				sessionId: "ses_alex_phone",
				endpoint: fcm("second"),
			},
		]);
		// Saving the same one again changes nothing.
		expect(await save("usr_alex", "ses_alex_phone", fcm("second"))).toBe(
			"saved",
		);
		expect(devices()).toHaveLength(1);
	});

	test("keeps the endpoint as a URL writes it, so one address can't pass for two", async () => {
		await save(
			"usr_alex",
			"ses_alex_phone",
			"https://FCM.googleapis.com/fcm/send/abc",
		);
		expect(devices()).toEqual([
			{
				userId: "usr_alex",
				sessionId: "ses_alex_phone",
				endpoint: "https://fcm.googleapis.com/fcm/send/abc",
			},
		]);
		expect(normalEndpoint("https://FCM.googleapis.com:443/fcm/send/abc")).toBe(
			"https://fcm.googleapis.com/fcm/send/abc",
		);
		expect(
			await save(
				"usr_sam",
				"ses_sam",
				"https://fcm.googleapis.com:443/fcm/send/abc",
			),
		).toBe("someone-else");
	});

	test("an endpoint moves from the person's older session, never from someone else's", async () => {
		await save("usr_alex", "ses_alex_laptop", fcm("browser"));
		expect(await save("usr_alex", "ses_alex_phone", fcm("browser"))).toBe(
			"saved",
		);
		expect(devices()).toEqual([
			{
				userId: "usr_alex",
				sessionId: "ses_alex_phone",
				endpoint: fcm("browser"),
			},
		]);

		expect(await save("usr_sam", "ses_sam", fcm("browser"))).toBe(
			"someone-else",
		);
		expect(devices()).toEqual([
			{
				userId: "usr_alex",
				sessionId: "ses_alex_phone",
				endpoint: fcm("browser"),
			},
		]);
	});

	test(`at most ${DEVICE_LIMIT} devices, not counting sessions that ran out`, async () => {
		for (let i = 0; i < DEVICE_LIMIT; i++) {
			addSession(`ses_alex_${i}`, "usr_alex");
			expect(await save("usr_alex", `ses_alex_${i}`, fcm(`device-${i}`))).toBe(
				"saved",
			);
		}
		expect(await save("usr_alex", "ses_alex_phone", fcm("one-more"))).toBe(
			"too-many",
		);
		// A device already counted can still change its endpoint.
		expect(await save("usr_alex", "ses_alex_0", fcm("device-0-again"))).toBe(
			"saved",
		);
		// Someone else isn't held back.
		expect(await save("usr_sam", "ses_sam", fcm("sam"))).toBe("saved");

		sqlite.run("UPDATE session SET expires_at = 0 WHERE id = 'ses_alex_3'");
		expect(await save("usr_alex", "ses_alex_phone", fcm("one-more"))).toBe(
			"saved",
		);
		const alex = devices().filter(
			(device) => (device as { userId: string }).userId === "usr_alex",
		);
		expect(alex).toHaveLength(DEVICE_LIMIT);
		expect(
			alex.some(
				(device) =>
					(device as { sessionId: string }).sessionId === "ses_alex_3",
			),
		).toBe(false);
	});

	test(`subscribes at the same moment can't pass ${DEVICE_LIMIT} devices together`, async () => {
		const sessions = Array.from(
			{ length: DEVICE_LIMIT + 1 },
			(_, i) => `ses_alex_${i}`,
		);
		for (const id of sessions) addSession(id, "usr_alex");
		const results = await Promise.all(
			sessions.map((id) => save("usr_alex", id, fcm(id))),
		);
		expect(results.filter((result) => result === "saved")).toHaveLength(
			DEVICE_LIMIT,
		);
		expect(results).toContain("too-many");
		expect(devices()).toHaveLength(DEVICE_LIMIT);
	});

	test("only push services, and only a browser's keys", async () => {
		for (const endpoint of [
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://collector.example.test/push",
			"not a url",
		])
			expect(await save("usr_alex", "ses_alex_phone", endpoint)).toBe(
				"not-a-push-service",
			);
		expect(
			await saveSubscription(db, {
				userId: "usr_alex",
				sessionId: "ses_alex_phone",
				endpoint: fcm("abc"),
				keys: { ...keys, auth: "c2hvcnQ" },
			}),
		).toBe("not-a-subscription");
		expect(devices()).toEqual([]);
	});

	test("a session's device goes with the session", async () => {
		await save("usr_alex", "ses_alex_phone", fcm("phone"));
		sqlite.run("DELETE FROM session WHERE id = 'ses_alex_phone'");
		expect(devices()).toEqual([]);
	});
});
