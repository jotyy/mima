// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
	VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL as string,
} satisfies Pick<PublicCoercedEnvSchema, "VITE_SERVER_URL">;

/**
 * The API's address, without a trailing slash. A deploy from the Deploy to Cloudflare
 * button serves the app and the API from one Worker and builds with no VITE_SERVER_URL:
 * the API is wherever the app is.
 */
export const serverUrl = () =>
	(ENV.VITE_SERVER_URL || window.location.origin).replace(/\/$/, "");
