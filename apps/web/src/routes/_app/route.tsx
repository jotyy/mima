import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import Loader from "@/components/loader";
import { UnlockScreen } from "@/components/unlock-screen";
import { useKeyring } from "@/lib/keyring";

export const Route = createFileRoute("/_app")({
	component: AppGate,
});

function AppGate() {
	const { status } = useKeyring();
	if (status === "loading") return <Loader />;
	if (status === "signed-out") return <Navigate to="/login" />;
	if (status === "locked") return <UnlockScreen />;
	return <AppShell />;
}
