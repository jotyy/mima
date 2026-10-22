import { Toaster } from "@mima/ui/components/sonner";
import { TooltipProvider } from "@mima/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
} from "@tanstack/react-router";

import { ThemeProvider } from "@/components/theme-provider";
import type { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	notFoundComponent: NotFound,
	head: () => ({
		meta: [
			{ title: "mima" },
			{
				name: "description",
				content: "A password manager for small teams and their agents.",
			},
		],
		links: [{ rel: "icon", href: "/favicon.ico" }],
	}),
});

function NotFound() {
	return (
		<div className="bg-frame flex min-h-svh flex-col items-center justify-center gap-2 text-center">
			<h1 className="text-fg text-h4">Nothing here</h1>
			<Link to="/" className="text-body-sm text-link hover:underline">
				Back to the overview
			</Link>
		</div>
	);
}

function RootComponent() {
	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="system"
				disableTransitionOnChange
				storageKey="mima-theme"
			>
				<TooltipProvider delay={300}>
					<Outlet />
				</TooltipProvider>
				<Toaster position="bottom-right" />
			</ThemeProvider>
		</>
	);
}
