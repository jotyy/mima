import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	vite: () => ({
		plugins: [tailwindcss()],
	}),
	manifest: {
		name: "vauly: Password Manager for Teams",
		description:
			"Fill and save your team's logins and passkeys from vauly, the open-source, end-to-end encrypted password manager you host yourself.",
		// storage: the server address and the unlocked key (in session memory only).
		// scripting: fill a login form when you choose Fill. alarms: lock after idle time.
		permissions: ["storage", "scripting", "alarms"],
		// Filling and offering to save logins work on any site, and each team's vauly server
		// has its own address.
		host_permissions: ["<all_urls>"],
		action: { default_title: "vauly" },
		// The popup and vauly's windows derive the key from the master password with
		// Argon2id, which is WebAssembly. Chrome's default policy already allows compiling it; Firefox's doesn't.
		content_security_policy: {
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
		},
		// The fill menu is this page, framed inside the site's page; the button in a login
		// field shows the mark. Their addresses change every session, so a site can't
		// frame the menu itself. vauly's other windows aren't reachable from sites at all.
		web_accessible_resources: [
			{
				resources: ["inline.html", "icon/32.png"],
				matches: ["http://*/*", "https://*/*"],
				use_dynamic_url: true,
			},
		],
	},
});
