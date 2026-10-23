import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { securityTxt } from "@vauly/ui/lib/security-txt";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { headersFile } from "./security-headers";

/** A VITE_ setting: the stack passes them through `define`, a plain build reads the env. */
function setting(config: ResolvedConfig | undefined, name: string) {
	const defined = config?.define?.[`import.meta.env.${name}`];
	if (typeof defined === "string") {
		try {
			return String(JSON.parse(defined));
		} catch {
			return defined;
		}
	}
	return config?.env[name] ?? "";
}

/**
 * Serves /vauly.json with the API address, so the browser extension can connect from the
 * web app address people already know. Without an API address the app and the API share
 * one Worker, which answers /vauly.json itself.
 */
function vaulyJson(): Plugin {
	let config: ResolvedConfig | undefined;
	const server = () => setting(config, "VITE_SERVER_URL");
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

/** Writes _headers: the Content-Security-Policy and the other headers the app needs. */
function securityHeaders(): Plugin {
	let config: ResolvedConfig | undefined;
	return {
		name: "vauly-security-headers",
		apply: "build",
		configResolved(resolved) {
			config = resolved;
		},
		generateBundle() {
			const source = headersFile({
				server: setting(config, "VITE_SERVER_URL"),
				logos: setting(config, "VITE_BRANDFETCH_CLIENT_ID") !== "off",
				breaches: setting(config, "VITE_BREACH_CHECK") !== "off",
			});
			this.emitFile({ type: "asset", fileName: "_headers", source });
		},
	};
}

/** Serves /.well-known/security.txt, which tells researchers where to report a problem. */
function securityTxtFile(): Plugin {
	return {
		name: "vauly-security-txt",
		configureServer(dev) {
			dev.middlewares.use("/.well-known/security.txt", (_request, response) => {
				response.setHeader("content-type", "text/plain; charset=utf-8");
				response.end(securityTxt());
			});
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: ".well-known/security.txt",
				source: securityTxt(),
			});
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
			securityHeaders(),
			securityTxtFile(),
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
