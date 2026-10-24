import { describe, expect, test } from "bun:test";

import { approvalNotice, pushServiceAllowed, signInNotice } from "./notify";

describe("pushServiceAllowed", () => {
	test("the push services of the browsers vauly runs in", () => {
		for (const endpoint of [
			"https://fcm.googleapis.com/fcm/send/abc:def",
			"https://fcm.googleapis.com/wp/abc",
			"https://updates.push.services.mozilla.com/wpush/v2/abc",
			"https://web.push.apple.com/QGuQyavXutnMH",
			"https://wns2-par02p.notify.windows.com/w/?token=abc",
		])
			expect(pushServiceAllowed(endpoint)).toBe(true);
	});

	test("nowhere else", () => {
		for (const endpoint of [
			"http://fcm.googleapis.com/fcm/send/abc",
			"https://fcm.googleapis.com:8443/fcm/send/abc",
			"https://fcm.googleapis.com.evil.example.test/x",
			"https://evil.example.test/fcm.googleapis.com",
			"https://user:pass@fcm.googleapis.com/x",
			"https://notify.windows.com/x",
			"https://a.b.notify.windows.com/x",
			"http://localhost:3305/push/abc",
			"not a url",
		])
			expect(pushServiceAllowed(endpoint)).toBe(false);
	});

	test("the e2e stack's stand-in on localhost, only when asked", () => {
		expect(
			pushServiceAllowed("http://localhost:3305/push/abc", { localhost: true }),
		).toBe(true);
		expect(
			pushServiceAllowed("http://127.0.0.1:3305/push/abc", { localhost: true }),
		).toBe(false);
	});
});

describe("notices", () => {
	test("name the agent and count the items, never an item", () => {
		const agent = { id: "agt_1", name: "CI deploy" };
		expect(approvalNotice(agent, 1)).toMatchObject({
			title: "CI deploy wants to use 1 item",
			body: "Open vauly to approve or deny.",
			url: "/agents",
			tag: "approval:agt_1",
			urgent: true,
		});
		expect(approvalNotice(agent, 3).title).toBe(
			"CI deploy wants to use 3 items",
		);
		expect(signInNotice("Chrome on macOS", "ses_1")).toMatchObject({
			title: "New sign-in to your vauly",
			body: "Chrome on macOS. If this wasn't you, sign it out in Settings.",
			url: "/settings",
			tag: "sign-in:ses_1",
		});
	});
});
