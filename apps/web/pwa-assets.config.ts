import {
	defineConfig,
	minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// Every icon comes from the mark in public/favicon.svg: favicon.ico (48), the SVG favicon,
// PWA icons (64/192/512), a maskable icon and the Apple touch icon on white.
export default defineConfig({
	headLinkOptions: {
		preset: "2023",
	},
	preset: {
		...minimal2023Preset,
		transparent: {
			...minimal2023Preset.transparent,
			padding: 0.08,
		},
		maskable: {
			...minimal2023Preset.maskable,
			padding: 0.32,
			resizeOptions: { background: "#FFFFFF", fit: "contain" },
		},
		apple: {
			...minimal2023Preset.apple,
			padding: 0.24,
			resizeOptions: { background: "#FFFFFF", fit: "contain" },
		},
	},
	images: ["public/favicon.svg"],
});
