import type { AppRouterClient } from "@mima/api/routers/index";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";

import { notify } from "../components/notify";
import { ENV } from "../env.public";

export function createQueryClient() {
	return new QueryClient({
		defaultOptions: { queries: { retry: 1 } },
		queryCache: new QueryCache({
			onError: (error, query) => {
				// Background refreshes fail quietly; only first loads tell the person.
				if (query.state.data === undefined) {
					notify.error("Couldn't load", error.message);
				}
			},
		}),
	});
}

export const queryClient = createQueryClient();

export const link = new RPCLink({
	url: `${ENV.VITE_SERVER_URL.replace(/\/$/, "")}/rpc`,
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
