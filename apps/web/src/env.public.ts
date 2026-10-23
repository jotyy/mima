// Alchemy validates deployment inputs with Varlock; Workers use native env bindings.
import type { PublicCoercedEnvSchema } from "./env";

export const ENV = {
	VITE_SERVER_URL: import.meta.env.VITE_SERVER_URL as string,
	VITE_DEMO_EMAIL: import.meta.env.VITE_DEMO_EMAIL as string | undefined,
	VITE_DEMO_PASSWORD: import.meta.env.VITE_DEMO_PASSWORD as string | undefined,
} satisfies Pick<
	PublicCoercedEnvSchema,
	"VITE_SERVER_URL" | "VITE_DEMO_EMAIL" | "VITE_DEMO_PASSWORD"
>;

/**
 * The demo at demo.vauly.app: the account every visitor shares. Everywhere else it's
 * null, and nothing about the demo shows.
 */
export const demoAccount = ENV.VITE_DEMO_EMAIL
	? { email: ENV.VITE_DEMO_EMAIL, password: ENV.VITE_DEMO_PASSWORD ?? "" }
	: null;

/**
 * The API's address, without a trailing slash. A deploy from the Deploy to Cloudflare
 * button serves the app and the API from one Worker and builds with no VITE_SERVER_URL:
 * the API is wherever the app is.
 */
export const serverUrl = () =>
	(ENV.VITE_SERVER_URL || window.location.origin).replace(/\/$/, "");
