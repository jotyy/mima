import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { OPEN_PAGE } from "./lib/notifications";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
	defaultPendingComponent: () => <Loader />,
	context: { orpc, queryClient },
	Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
	},
});

// A tapped notification, in a window that's already open: go to its page without a reload,
// which would lock vauly.
navigator.serviceWorker?.addEventListener("message", (event) => {
	const data = event.data as { type?: unknown; path?: unknown } | null;
	if (data?.type !== OPEN_PAGE || typeof data.path !== "string") return;
	if (!data.path.startsWith("/") || data.path.startsWith("//")) return;
	router.history.push(data.path);
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("app");

if (!rootElement) {
	throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(<RouterProvider router={router} />);
}
