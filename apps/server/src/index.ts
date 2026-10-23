import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { appRouter } from "@vauly/api/routers/index";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createContext } from "./context";
import { resetDatabase } from "./e2e-reset";
import { ENV } from "./env.server";
import { createAuth, getDb, prepare } from "./services";

const app = new Hono();

app.use(logger());
// Only when the app is served from another address. A deploy from the Deploy to
// Cloudflare button is one Worker for both, so the browser never asks.
if (ENV.CORS_ORIGIN) {
	app.use(
		"/*",
		cors({
			origin: ENV.CORS_ORIGIN,
			allowMethods: ["GET", "POST", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization", "X-Vauly-Code"],
			credentials: true,
		}),
	);
}

app.on(["POST", "GET"], "/api/auth/*", async (c) =>
	(await createAuth(new URL(c.req.url).origin)).handler(c.req.raw),
);

// Where the browser extension finds the API. With one Worker for the app and the API,
// it's this same address; a separate web app serves its own copy, naming the API.
app.get("/vauly.json", (c) => c.json({ server: new URL(c.req.url).origin }));

if (ENV.E2E_RESET_TOKEN) {
	app.post("/__e2e/reset", async (c) => {
		if (c.req.header("x-reset-token") !== ENV.E2E_RESET_TOKEN) {
			return c.text("Forbidden", 403);
		}
		await prepare();
		await resetDatabase(getDb());
		return c.text("OK");
	});
}

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			console.error(error);
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context: context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context: context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	await next();
});

app.get("/", (c) => {
	return c.text("OK");
});

export default app;
