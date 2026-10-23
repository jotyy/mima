import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

// The e2e suite runs its own stack (stage `e2e`) next to `bun run dev`, on other ports.
const apiPort = Number(process.env.VAULY_API_PORT ?? 3000);
const webPort = Number(process.env.VAULY_WEB_PORT ?? 3001);

export const db = Cloudflare.D1.Database("database", {
	migrations: "../../packages/db/src/migrations",
});

export const server = Cloudflare.Worker("server", {
	main: "../../apps/server/src/index.ts",
	env: {
		DB: db,
		CORS_ORIGIN: process.env.VAULY_WEB_PORT
			? `http://localhost:${webPort}`
			: Config.String("CORS_ORIGIN"),
		BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
		BETTER_AUTH_URL: Cloudflare.Worker.URL,
		// Only the e2e stack sets this; without it the reset route does not exist.
		E2E_RESET_TOKEN: process.env.VAULY_E2E_RESET_TOKEN ?? "",
		// When set, creating the workspace needs the setup link with this code.
		SETUP_CODE: process.env.VAULY_SETUP_CODE ?? "",
	},
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
			dev: {
				port: webPort,
			},
		});

		return {
			web: webWorker.url,
			server: serverWorker.url,
		};
	}),
);
