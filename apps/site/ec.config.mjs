import { defineEcConfig } from "@astrojs/starlight/expressive-code";

// Code blocks in the docs: a real syntax theme, framed like the app's cards. It lives
// here rather than in astro.config.mjs because the colors are functions, which only this
// file can pass on. They're Pure's own values; Expressive Code works others out from them.
// The dev server caches rendered pages: after changing this, delete .astro/data-store.json
// and node_modules/.astro/data-store.json, or pages link a stylesheet that's gone.

/** Pure's colors, light and dark, as in packages/ui/src/styles/pure.css. */
const colors = {
	light: {
		surface: "#ffffff",
		sunken: "#f6f6f7",
		line: "#e9e9ec",
		strong: "#d8d8dd",
		muted: "#55555c",
	},
	dark: {
		surface: "#131316",
		sunken: "#18181b",
		line: "#222226",
		strong: "#2e2e33",
		muted: "#ababb3",
	},
};
const pure =
	(name) =>
	({ theme }) =>
		colors[theme.type === "dark" ? "dark" : "light"][name];

export default defineEcConfig({
	themes: ["github-dark-default", "github-light-default"],
	styleOverrides: {
		borderRadius: "0.625rem",
		borderColor: pure("line"),
		codeFontFamily: "var(--font-code)",
		codeFontSize: "0.8125rem",
		codeLineHeight: "1.7",
		codeBackground: pure("sunken"),
		uiFontFamily: "var(--font-text)",
		uiFontSize: "0.75rem",
		frames: {
			shadowColor: "transparent",
			editorBackground: pure("sunken"),
			terminalBackground: pure("sunken"),
			editorTabBarBackground: pure("surface"),
			editorActiveTabBackground: pure("sunken"),
			editorActiveTabIndicatorTopColor: "transparent",
			editorActiveTabIndicatorBottomColor: "transparent",
			editorTabBarBorderBottomColor: pure("line"),
			terminalTitlebarBackground: pure("surface"),
			terminalTitlebarBorderBottomColor: pure("line"),
			terminalTitlebarDotsForeground: pure("strong"),
			terminalTitlebarDotsOpacity: "1",
			inlineButtonBorder: pure("line"),
			inlineButtonForeground: pure("muted"),
		},
	},
});
