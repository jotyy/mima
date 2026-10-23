import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	manifest: {
		name: "mima",
		description: "Fill, copy and save your mima logins in the browser.",
		// storage: the server address and the unlocked key (in session memory only).
		// scripting: fill a login form when you choose Fill. alarms: lock after idle time.
		permissions: ["storage", "scripting", "alarms"],
		// Filling and offering to save logins work on any site, and each team's mima server
		// has its own address.
		host_permissions: ["<all_urls>"],
		action: { default_title: "mima" },
	},
});
