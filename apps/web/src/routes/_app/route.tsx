import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import Loader from "@/components/loader";
import { TwoStepRequiredScreen } from "@/components/two-step-required";
import { UnlockScreen } from "@/components/unlock-screen";
import { useKeyring } from "@/lib/keyring";

export const Route = createFileRoute("/_app")({
	component: AppGate,
});

function AppGate() {
	const { status, needsTwoStep } = useKeyring();
	if (status === "loading") return <Loader />;
	if (status === "signed-out") return <Navigate to="/login" />;
	// Before unlocking: the workspace requires it, and setting it up takes no keys.
	if (needsTwoStep) return <TwoStepRequiredScreen />;
	if (status === "locked") return <UnlockScreen />;
	return <AppShell />;
}
