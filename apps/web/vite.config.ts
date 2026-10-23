import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Serves /vauly.json with the API address, so the browser extension can connect from the
 * web app address people already know. Without an API address the app and the API share
 * one Worker, which answers /vauly.json itself.
 */
function vaulyJson(): Plugin {
	// The stack passes VITE_SERVER_URL through `define`; a plain build reads it from the env.
	let config: ResolvedConfig | undefined;
	const server = () => {
		const defined = config?.define?.["import.meta.env.VITE_SERVER_URL"];
		if (typeof defined === "string") {
			try {
				return String(JSON.parse(defined));
			} catch {
				return defined;
			}
		}
		return config?.env.VITE_SERVER_URL ?? "";
	};
	const body = () => JSON.stringify({ server: server() });
	return {
		name: "vauly-json",
		configResolved(resolved) {
			config = resolved;
		},
		configureServer(dev) {
			dev.middlewares.use("/vauly.json", (_request, response) => {
				response.setHeader("content-type", "application/json");
				response.end(body());
			});
		},
		generateBundle() {
			if (!server()) return;
			this.emitFile({ type: "asset", fileName: "vauly.json", source: body() });
		},
	};
}

export default defineConfig(() => {
	return {
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
			vaulyJson(),
			VitePWA({
				registerType: "autoUpdate",
				workbox: {
					globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
					// When one Worker serves the app and the API, the API's pages aren't the app's.
					navigateFallbackDenylist: [/^\/api/, /^\/rpc/, /^\/vauly\.json/],
				},
				manifest: {
					name: "vauly",
					short_name: "vauly",
					description: "A password manager for small teams.",
					theme_color: "#FAFAFA",
					background_color: "#FAFAFA",
					// Made by brand/build.ts, from the same artwork as the logo.
					icons: [
						{ src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
						{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
						{ src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
						{
							src: "maskable-icon-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "maskable",
						},
					],
				},
				devOptions: { enabled: true },
			}),
		],
	};
});
