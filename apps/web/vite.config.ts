import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Serves /mima.json with the API address, so the browser extension can connect from the
 * web app address people already know.
 */
function mimaJson(): Plugin {
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
		name: "mima-json",
		configResolved(resolved) {
			config = resolved;
		},
		configureServer(dev) {
			dev.middlewares.use("/mima.json", (_request, response) => {
				response.setHeader("content-type", "application/json");
				response.end(body());
			});
		},
		generateBundle() {
			this.emitFile({ type: "asset", fileName: "mima.json", source: body() });
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
			mimaJson(),
			VitePWA({
				registerType: "autoUpdate",
				workbox: { globPatterns: ["**/*.{js,css,html,png,svg,ico}"] },
				manifest: {
					name: "mima",
					short_name: "mima",
					description: "A password manager for small teams.",
					theme_color: "#FAFAFA",
					background_color: "#FAFAFA",
				},
				pwaAssets: { disabled: false, config: true },
				devOptions: { enabled: true },
			}),
		],
	};
});
