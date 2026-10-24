import { LOGO_ORIGIN } from "@vauly/ui/lib/logos";

import { PWNED_PASSWORDS_ORIGIN } from "./src/lib/pwned-passwords";

// The headers the app's pages and files are served with. The build writes them to
// dist/_headers, which Workers Static Assets apply in both deploy shapes: the one Worker
// from wrangler.jsonc and the Alchemy stack's web Website. `vite dev` ignores the file;
// its pages need inline scripts anyway.

export type HeaderOptions = {
	/** The API's address when it has a domain of its own; empty when it shares the app's. */
	server: string;
	/** Whether this build shows website logos, which load from Brandfetch. */
	logos: boolean;
	/** Whether this build checks passwords against Have I Been Pwned. */
	breaches: boolean;
};

export function contentSecurityPolicy({
	server,
	logos,
	breaches,
}: HeaderOptions) {
	const directives: [string, ...string[]][] = [
		["default-src", "'self'"],
		// Only the app's own script files run: nothing inline, nothing from a string.
		["script-src", "'self'"],
		// Toasts and the Emergency Kit add <style> elements; styles can't run code.
		["style-src", "'self'", "'unsafe-inline'"],
		// The data: images are the backgrounds and masks in the app's CSS.
		["img-src", "'self'", "data:", "blob:", ...(logos ? [LOGO_ORIGIN] : [])],
		[
			"connect-src",
			"'self'",
			...(server ? [new URL(server).origin] : []),
			...(breaches ? [PWNED_PASSWORDS_ORIGIN] : []),
		],
		["worker-src", "'self'"],
		["manifest-src", "'self'"],
		["object-src", "'none'"],
		["base-uri", "'none'"],
		["form-action", "'self'"],
		// No other site can show vauly in a frame and trick someone into a click.
		["frame-ancestors", "'none'"],
	];
	return directives.map((directive) => directive.join(" ")).join("; ");
}

/** Where the build puts the key worker and what it loads (vite.config.ts). */
export const KEY_WORKER_DIR = "assets/key-worker";

/**
 * The key worker's own policy, which browsers apply to a worker instead of the page's.
 * It runs Argon2id, which is WebAssembly, so it may compile that, and nothing else: it
 * loads only the app's files and can't connect anywhere. The page's policy still forbids
 * WebAssembly. A path in the folder that isn't a file gets the app's page instead, under
 * this policy, so it can't be framed or given another base either.
 */
export function keyWorkerPolicy() {
	return [
		"default-src 'none'",
		"script-src 'self' 'wasm-unsafe-eval'",
		"base-uri 'none'",
		"frame-ancestors 'none'",
	].join("; ");
}

export function headersFile(options: HeaderOptions) {
	const headers = {
		"Content-Security-Policy": contentSecurityPolicy(options),
		// For browsers that predate frame-ancestors.
		"X-Frame-Options": "DENY",
		"X-Content-Type-Options": "nosniff",
		// Brandfetch needs a Referer: the origin, never the path.
		"Referrer-Policy": "strict-origin-when-cross-origin",
		"Permissions-Policy":
			"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		"Cross-Origin-Opener-Policy": "same-origin",
		// No preload: the domain a team runs vauly on isn't ours to put on that list.
		"Strict-Transport-Security": "max-age=31536000",
	};
	const lines = Object.entries(headers).map(
		([name, value]) => `  ${name}: ${value}`,
	);
	// The key worker's files get the other headers, but its policy instead of the page's.
	const keyWorker = [
		"  ! Content-Security-Policy",
		`  Content-Security-Policy: ${keyWorkerPolicy()}`,
	];
	return `# Written by the build, from apps/web/security-headers.ts.\n/*\n${lines.join("\n")}\n\n/${KEY_WORKER_DIR}/*\n${keyWorker.join("\n")}\n`;
}
