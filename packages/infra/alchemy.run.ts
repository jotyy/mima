import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

// The e2e suite runs its own stack (stage `e2e`) next to `bun run dev`, on other ports.
const apiPort = Number(process.env.VAULY_API_PORT ?? 3000);
const webPort = Number(process.env.VAULY_WEB_PORT ?? 3001);
// The app's and the API's own domains, such as app.vauly.app and api.vauly.app; without
// them both stay on workers.dev. Keep the API on the same site as the app, so browsers
// that block third-party cookies still send it the session.
const appDomain = process.env.VAULY_APP_DOMAIN;
const apiDomain = process.env.VAULY_API_DOMAIN;

export const db = Cloudflare.D1.Database("database", {
	migrations: "../../packages/db/src/migrations",
});

export const server = Cloudflare.Worker("server", {
	main: "../../apps/server/src/index.ts",
	env: {
		DB: db,
		CORS_ORIGIN: process.env.VAULY_WEB_PORT
			? `http://localhost:${webPort}`
			: appDomain
				? `https://${appDomain}`
				: Config.String("CORS_ORIGIN"),
		BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
		BETTER_AUTH_URL: Cloudflare.Worker.URL,
		// Only the e2e stack sets this; without it the reset route does not exist.
		E2E_RESET_TOKEN: process.env.VAULY_E2E_RESET_TOKEN ?? "",
		// When set, creating the workspace needs the setup link with this code.
		SETUP_CODE: process.env.VAULY_SETUP_CODE ?? "",
	},
	domain: apiDomain,
	dev: {
		port: apiPort,
	},
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
	"vauly",
	{
		providers: Cloudflare.providers(),
		// `bun run dev` keeps state on disk so local development needs no Cloudflare login.
		state: process.env.VAULY_LOCAL_STATE
			? Alchemy.localState()
			: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const serverWorker = yield* server;
		const webWorker = yield* Cloudflare.Website.Vite("web", {
			rootDir: "../../apps/web",
			assets: {
				htmlHandling: "auto-trailing-slash",
				notFoundHandling: "single-page-application",
			},
			env: {
				VITE_SERVER_URL: serverWorker.url.as<string>(),
			},
			domain: appDomain,
			dev: {
				port: webPort,
			},
		});

		// The website (landing page and docs) is static and lives at vauly.app, so only
		// production deploys it; locally it runs on its own with `bun run dev` in apps/site.
		if ((yield* Alchemy.Stage) !== "production") {
			return {
				web: webWorker.url,
				server: serverWorker.url,
			};
		}
		const siteWorker = yield* Cloudflare.Website.StaticSite("site", {
			cwd: "../../apps/site",
			command: "bun run build",
			outdir: "dist",
			assets: {
				htmlHandling: "auto-trailing-slash",
				notFoundHandling: "404-page",
			},
			domain: { name: "vauly.app", redirects: ["www.vauly.app"] },
		});

		return {
			web: webWorker.url,
			server: serverWorker.url,
			site: siteWorker.url,
		};
	}),
);
