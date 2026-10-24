import { describe, expect, mock, test } from "bun:test";

import {
	noticePath,
	OPEN_PAGE,
	openNotice,
	readNotice,
	showNotice,
} from "./notifications";

const origin = "https://vauly.example.test";

describe("readNotice", () => {
	test("reads what the server sends, and nothing else", () => {
		expect(
			readNotice(
				JSON.stringify({
					title: "CI deploy wants to use 1 item",
					body: "Open vauly to approve or deny.",
					url: "/agents",
					tag: "approval:agt_1",
				}),
			),
		).toEqual({
			title: "CI deploy wants to use 1 item",
			body: "Open vauly to approve or deny.",
			url: "/agents",
			tag: "approval:agt_1",
		});
		expect(readNotice("not json")).toBeNull();
		expect(readNotice(JSON.stringify({ title: 1, body: "x" }))).toBeNull();
		expect(readNotice(null)).toBeNull();
	});

	test("shows it with its tag, so a later one replaces it", async () => {
		const showNotification = mock(async () => {});
		await showNotice(
			{ showNotification } as unknown as ServiceWorkerRegistration,
			JSON.stringify({ title: "T", body: "B", url: "/agents", tag: "x" }),
		);
		expect(showNotification).toHaveBeenCalledWith("T", {
			body: "B",
			icon: "/pwa-192x192.png",
			badge: "/pwa-192x192.png",
			data: { url: "/agents" },
			tag: "x",
		});
	});
});

describe("noticePath", () => {
	test("only ever a page of the app", () => {
		expect(noticePath({ url: "/agents" }, origin)).toBe("/agents");
		expect(noticePath({ url: "/settings?tab=1" }, origin)).toBe(
			"/settings?tab=1",
		);
		expect(noticePath({ url: "https://evil.example.test/x" }, origin)).toBe(
			"/",
		);
		expect(noticePath({ url: "//evil.example.test/x" }, origin)).toBe("/");
		expect(noticePath({ url: "/.//evil.example.test/x" }, origin)).toBe("/");
		expect(noticePath({ url: "/agents/..//evil.example.test" }, origin)).toBe(
			"/",
		);
		expect(noticePath({ url: "javascript:alert(1)" }, origin)).toBe("/");
		expect(noticePath(null, origin)).toBe("/");
	});
});

describe("openNotice", () => {
	const window = (url: string) => ({
		url,
		focus: mock(async () => {}),
		postMessage: mock(() => {}),
	});

	test("an open vauly window goes to the page itself, so it stays unlocked", async () => {
		const other = window("https://elsewhere.example.test/");
		const app = window(`${origin}/items`);
		const openWindow = mock(async () => null);
		await openNotice(
			{ matchAll: async () => [other, app], openWindow },
			origin,
			{ url: "/agents" },
		);
		expect(app.focus).toHaveBeenCalled();
		expect(app.postMessage).toHaveBeenCalledWith({
			type: OPEN_PAGE,
			path: "/agents",
		});
		expect(other.focus).not.toHaveBeenCalled();
		expect(openWindow).not.toHaveBeenCalled();
	});

	test("without one, a new window opens on the page", async () => {
		const openWindow = mock(async () => null);
		await openNotice({ matchAll: async () => [], openWindow }, origin, {
			url: "/settings",
		});
		expect(openWindow).toHaveBeenCalledWith(`${origin}/settings`);
	});
});
