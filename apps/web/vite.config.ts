import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	server: {
		port: 3001,
	},
	resolve: {
		tsconfigPaths: true,
	},
	plugins: [
		tailwindcss(),
		tanstackRouter({
			target: "react",
			autoCodeSplitting: true,
		}),
		react(),
		VitePWA({
			registerType: "autoUpdate",
			workbox: { globPatterns: ["**/*.{js,css,html,png,svg,ico}"] },
			manifest: {
				name: "mima",
				short_name: "mima",
				description: "mima - PWA Application",
				theme_color: "#0c0c0c",
			},
			pwaAssets: { disabled: false, config: true },
			devOptions: { enabled: true },
		}),
	],
});
