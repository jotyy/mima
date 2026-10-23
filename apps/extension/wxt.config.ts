import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	manifest: {
		name: "vauly",
		description: "Fill, copy and save your vauly logins in the browser.",
		// storage: the server address and the unlocked key (in session memory only).
		// scripting: fill a login form when you choose Fill. alarms: lock after idle time.
		permissions: ["storage", "scripting", "alarms"],
		// Filling and offering to save logins work on any site, and each team's vauly server
		// has its own address.
		host_permissions: ["<all_urls>"],
		action: { default_title: "vauly" },
		// The fill menu and the save prompt are this page, framed inside the site's page;
		// the button in a login field shows the mark.
		web_accessible_resources: [
			{
				resources: ["inline.html", "icon/32.png"],
				matches: ["http://*/*", "https://*/*"],
			},
		],
	},
});
