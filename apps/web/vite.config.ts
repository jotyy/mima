import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { securityTxt } from "@vauly/ui/lib/security-txt";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type ResolvedConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import {
	buildCommit,
	buildDate,
	buildManifest,
	buildVersion,
	MANIFEST_PATH,
} from "./build-manifest";
import { headersFile, KEY_WORKER_DIR } from "./security-headers";

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
 * The instance's settings, which the app reads at runtime from /vauly.json instead of
 * having them compiled in: that keeps the app's files the same for every instance, so
 * anyone can check them against a build of their own. The browser extension reads the
 * API's address there too.
 */
function instanceConfig(config: ResolvedConfig | undefined) {
	const email = setting(config, "VITE_DEMO_EMAIL");
	return {
		server: setting(config, "VITE_SERVER_URL"),
		brandfetch: setting(config, "VITE_BRANDFETCH_CLIENT_ID"),
		breachCheck: setting(config, "VITE_BREACH_CHECK") !== "off",
		...(email && {
			demo: { email, password: setting(config, "VITE_DEMO_PASSWORD") },
		}),
	};
}

/**
 * Writes /vauly.json from the build's settings. When one Worker serves the app and the
 * API, it answers /vauly.json itself, from this file, with its own address as the API's.
 */
function vaulyJson(): Plugin {
	let config: ResolvedConfig | undefined;
	// The settings, and which vauly this is, for Settings › About and anyone who asks.
	const body = () =>
		JSON.stringify({
			...instanceConfig(config),
			version: buildVersion(),
			commit: buildCommit(),
		});
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
				// Dated from the commit, not the clock, so two builds of it agree.
				source: securityTxt({ now: buildDate() }),
			});
		},
	};
}

/**
 * Writes /.well-known/vauly-build.json once every other file is written, the service
 * worker included: each file's SHA-256 and the commit (build-manifest.ts).
 */
function buildManifestFile(): Plugin {
	let config: ResolvedConfig | undefined;
	return {
		name: "vauly-build-manifest",
		apply: "build",
		enforce: "post",
		configResolved(resolved) {
			config = resolved;
		},
		closeBundle: {
			order: "post",
			sequential: true,
			handler() {
				if (!config) return;
				const outDir = path.resolve(config.root, config.build.outDir);
				const manifest = buildManifest(outDir, instanceConfig(config));
				const file = path.join(outDir, MANIFEST_PATH);
				mkdirSync(path.dirname(file), { recursive: true });
				writeFileSync(file, `${JSON.stringify(manifest, null, "\t")}\n`);
			},
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
		// What the key worker, the import worker and the service worker load, bundled when
		// the dev server starts rather than when one first runs, which would reload the page.
		// The dev server finds the page's own dependencies by itself.
		optimizeDeps: {
			include: [
				"@vauly/crypto > libsodium-wrappers-sumo",
				"@vauly/crypto > hash-wasm",
				"workbox-core",
				"workbox-precaching",
				"workbox-routing",
				"kdbxweb",
				"hash-wasm",
			],
		},
		// The key worker (src/lib/argon2.worker.ts), the import worker that opens KeePass
		// databases (src/lib/import/kdbx.worker.ts) and everything they load go in a folder
		// of their own, which _headers serves with the workers' CSP (security-headers.ts).
		worker: {
			format: "es" as const,
			rolldownOptions: {
				output: {
					entryFileNames: `${KEY_WORKER_DIR}/[name]-[hash].js`,
					chunkFileNames: `${KEY_WORKER_DIR}/[name]-[hash].js`,
					assetFileNames: `${KEY_WORKER_DIR}/[name]-[hash][extname]`,
				},
			},
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
				// The icons are cached with the other files below; added again here, they'd come
				// after the sorted list, in the file system's order.
				includeManifestIcons: false,
				// vauly's own service worker, for notifications as well as the offline files.
				strategies: "injectManifest",
				srcDir: "src",
				filename: "sw.ts",
				injectManifest: {
					globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
					// Workbox lists the files in the order the file system hands them over, which
					// differs from one machine to the next. Sorted, sw.js is the same wherever
					// it's built, and `vauly verify --against` a release's manifest can match it.
					manifestTransforms: [
						(entries) => ({
							manifest: [...entries].sort((a, b) =>
								a.url < b.url ? -1 : a.url > b.url ? 1 : 0,
							),
						}),
					],
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
				devOptions: { enabled: true, type: "module" },
			}),
			buildManifestFile(),
		],
	};
});
