import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@mima/db";
import * as schema from "@mima/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins";

import { CODE_HEADER, checkSecondStep } from "./two-step";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
};

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "sqlite",
			schema,
		}),
		// The browser extension signs in from its own origin, which differs per install.
		trustedOrigins: [
			env.CORS_ORIGIN,
			"chrome-extension://",
			"moz-extension://",
			...desktopOrigins,
		],
		// The "password" is the auth key derived from the master password on the device;
		// the master password itself never reaches the server.
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 64,
			maxPasswordLength: 64,
		},
		session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		hooks: {
			// Accounts are created through `account.register`, which checks the invite and
			// stores the encrypted keys in the same step. Direct sign-up over HTTP is closed.
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path === "/sign-up/email" && ctx.request) {
					throw new APIError("FORBIDDEN", {
						message: "Sign up with an invite link",
					});
				}
			}),
			// Two-step login is checked once the password is right, so a wrong password never
			// tells anyone whether the account has it turned on. Without the code, the new
			// session is deleted again before anyone gets to use it.
			after: createAuthMiddleware(async (ctx) => {
				if (ctx.path !== "/sign-in/email") return;
				const created = ctx.context.newSession;
				if (!created) return;
				const result = await checkSecondStep(
					database,
					created.user.id,
					ctx.headers?.get(CODE_HEADER) ?? null,
				);
				if (result === "ok" || result === "not-needed") return;
				await ctx.context.internalAdapter.deleteSession(created.session.token);
				throw new APIError("UNAUTHORIZED", {
					code:
						result === "missing" ? "TWO_FACTOR_REQUIRED" : "TWO_FACTOR_WRONG",
					message:
						result === "missing"
							? "Enter the code from your authenticator app"
							: "That code didn't work",
				});
			}),
		},
		advanced: {
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		// The extension can't rely on cookies across sites, so it sends the session token
		// as a bearer token; the web app keeps using its cookie.
		plugins: [bearer()],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
