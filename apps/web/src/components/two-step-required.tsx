import { ShieldCheckIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { useState } from "react";

import { useKeyring } from "@/lib/keyring";
import { useWorkspace } from "@/lib/vault-data";

import { AuthLayout } from "./auth-layout";
import { TurnOnTwoStepDialog } from "./two-step-dialogs";

/**
 * In place of the app while the workspace requires two-step login and this account
 * hasn't set it up: the server opens nothing else until it has (memberProcedure).
 */
export function TwoStepRequiredScreen() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const [open, setOpen] = useState(false);
	const name = workspace.data?.workspaceName ?? "Your workspace";

	return (
		<AuthLayout
			title="Set up two-step login"
			description={`${name} requires two-step login. Set it up to open your vaults.`}
			footer={
				<p>
					Not now?{" "}
					<button
						type="button"
						onClick={() => keyring.signOut()}
						className="text-brand hover:text-brand-hover underline-offset-4 hover:underline"
					>
						Sign out
					</button>
				</p>
			}
		>
			<div className="flex flex-col gap-4">
				<p className="text-body-sm text-fg-muted text-pretty">
					Signing in will ask for a code from an authenticator app as well as
					your master password, so a password alone can't open your vaults. It
					takes a minute: scan a code, type the six digits it shows, and keep
					your recovery codes.
				</p>
				<Button onClick={() => setOpen(true)}>
					<ShieldCheckIcon data-icon="inline-start" />
					Set up two-step login
				</Button>
			</div>
			<TurnOnTwoStepDialog
				open={open}
				onOpenChange={setOpen}
				reloadWhenClosed
			/>
		</AuthLayout>
	);
}
