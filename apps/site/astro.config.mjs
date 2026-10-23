import preact from "@astrojs/preact";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// The landing page lives in src/pages; the docs are Starlight, under /docs, built from
// the repository's docs/ folder (see scripts/sync-docs.ts).
// Where the site will live. Links in the sitemap and the social preview use it.
const SITE = "https://mima.example.com";

export default defineConfig({
	site: SITE,
	devToolbar: { enabled: false },
	integrations: [
		starlight({
			title: "mima",
			description:
				"A self-hosted, end-to-end encrypted password manager for small teams.",
			logo: { src: "./src/assets/logo.svg", replacesTitle: true },
			favicon: "/favicon.svg",
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/jotyy/mima",
				},
			],
			sidebar: [
				{
					label: "Start here",
					items: [
						{ label: "Introduction", slug: "docs" },
						{ label: "Self-hosting", slug: "docs/self-hosting" },
					],
				},
				{
					label: "Using mima",
					items: [
						{ label: "Browser extension", slug: "docs/browser-extension" },
						{ label: "Agents and scripts", slug: "docs/agents" },
					],
				},
				{
					label: "Trust",
					items: [{ label: "Security", slug: "docs/security" }],
				},
			],
			customCss: ["./src/styles/docs.css"],
			components: {
				SocialIcons: "./src/components/docs/HeaderLinks.astro",
				ThemeSelect: "./src/components/docs/ThemeSelect.astro",
			},
			head: [
				{
					tag: "meta",
					attrs: { property: "og:image", content: `${SITE}/og.png` },
				},
				{
					tag: "meta",
					attrs: { name: "twitter:image", content: `${SITE}/og.png` },
				},
				{
					// Pure's tokens switch on data-style and on the .dark class; Starlight
					// keeps its theme in data-theme, so follow it.
					tag: "script",
					content: `{const r=document.documentElement;r.dataset.style="pure";const s=()=>r.classList.toggle("dark",r.dataset.theme==="dark");s();new MutationObserver(s).observe(r,{attributes:true,attributeFilter:["data-theme"]});}`,
				},
			],
		}),
		// The two interactive islands are Preact: a few kilobytes, not React's hundred.
		preact(),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
