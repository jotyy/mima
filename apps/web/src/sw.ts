/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
	cleanupOutdatedCaches,
	createHandlerBoundToURL,
	type PrecacheEntry,
	precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

import { openNotice, showNotice } from "./lib/notifications";

// vauly's service worker: the app's files kept on the device, so the installed app starts
// without a connection (and opens the offline copy), and notifications from the server.
// vite-plugin-pwa builds it and puts the list of files in for __WB_MANIFEST.

declare const self: ServiceWorkerGlobalScope & {
	__WB_MANIFEST: (string | PrecacheEntry)[];
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
// Every page of the app is index.html. The dev server's list is empty, and it serves the
// pages itself.
if (import.meta.env.PROD)
	registerRoute(
		new NavigationRoute(createHandlerBoundToURL("index.html"), {
			// When one Worker serves the app and the API, the API's pages aren't the app's.
			denylist: [/^\/api/, /^\/rpc/, /^\/vauly\.json/],
		}),
	);

// A new version takes over at once, as `registerType: "autoUpdate"` asks.
self.skipWaiting();
clientsClaim();

self.addEventListener("push", (event) => {
	event.waitUntil(showNotice(self.registration, event.data?.text()));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	event.waitUntil(
		openNotice(self.clients, self.location.origin, event.notification.data),
	);
});
