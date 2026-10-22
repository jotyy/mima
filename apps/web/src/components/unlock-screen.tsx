import { useState } from "react";

import { useKeyring, WrongPasswordError } from "@/lib/keyring";
import { errorMessage, useWorkspace } from "@/lib/vault-data";

import {
	AuthLayout,
	Field,
	FormError,
	PasswordInput,
	SubmitButton,
} from "./auth-layout";

export function UnlockScreen() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	return (
		<AuthLayout
			title={`Unlock ${workspace.data?.workspaceName ?? "mima"}`}
			description={
				<>Locked to keep your items safe. Signed in as {keyring.me?.email}.</>
			}
			footer={
				<p>
					Not {keyring.me?.name}?{" "}
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
			<form
				className="flex flex-col gap-4"
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
						className="h-10"
						autoFocus
						required
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<SubmitButton busy={busy} busyLabel="Unlocking…">
					Unlock
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
