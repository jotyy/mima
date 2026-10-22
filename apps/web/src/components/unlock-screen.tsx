import { Button } from "@mima/ui/components/button";
import { useState } from "react";

import { useKeyring, WrongPasswordError } from "@/lib/keyring";
import { errorMessage, useWorkspace } from "@/lib/vault-data";

import { AuthLayout, Field, FormError, PasswordInput } from "./auth-layout";

export function UnlockScreen() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	return (
		<AuthLayout
			title={`Unlock ${workspace.data?.workspaceName ?? "mima"}`}
			description={keyring.me?.email}
		>
			<form
				className="flex flex-col gap-3"
				onSubmit={async (event) => {
					event.preventDefault();
					setBusy(true);
					setError("");
					try {
						await keyring.unlock(password);
					} catch (err) {
						setError(
							err instanceof WrongPasswordError
								? "That's not the master password for this account."
								: errorMessage(err),
						);
						setPassword("");
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Master password">
					<PasswordInput
						autoFocus
						required
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<Button type="submit" size="lg" className="mt-1 w-full" disabled={busy}>
					{busy ? "Unlocking…" : "Unlock"}
				</Button>
			</form>
			<button
				type="button"
				onClick={() => keyring.signOut()}
				className="text-caption text-fg-muted decoration-fg/25 hover:text-fg mx-auto mt-5 block underline-offset-4 hover:underline"
			>
				Not {keyring.me?.name}? Sign out
			</button>
		</AuthLayout>
	);
}
