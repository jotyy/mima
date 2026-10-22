import { Input } from "@mima/ui/components/input";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
	AuthLayout,
	Field,
	FormError,
	PasswordInput,
	SubmitButton,
} from "@/components/auth-layout";
import Loader from "@/components/loader";
import { useKeyring, WrongPasswordError } from "@/lib/keyring";
import { errorMessage, useWorkspace } from "@/lib/vault-data";

export const Route = createFileRoute("/login")({
	component: SignIn,
});

function SignIn() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const navigate = useNavigate();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	if (keyring.status === "loading" || workspace.isPending) return <Loader />;
	if (keyring.status !== "signed-out") return <Navigate to="/" />;
	if (workspace.data && !workspace.data.hasOwner)
		return <Navigate to="/setup" />;

	return (
		<AuthLayout
			title={`Sign in to ${workspace.data?.workspaceName ?? "mima"}`}
			description="Use the email and master password you joined with."
			footer={<p>New here? Ask a teammate for an invite link.</p>}
			note="Forgot your master password? Nobody can reset it, not even an admin: it is the only key to your items."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setBusy(true);
					setError("");
					try {
						await keyring.signIn(email.trim(), password);
						await navigate({ to: "/" });
					} catch (err) {
						setError(
							err instanceof WrongPasswordError
								? "That email and master password don't match."
								: errorMessage(err),
						);
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Email">
					<Input
						type="email"
						autoComplete="username"
						required
						autoFocus
						placeholder="you@company.com"
						className="h-10"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
					/>
				</Field>
				<Field label="Master password">
					<PasswordInput
						autoComplete="current-password"
						required
						className="h-10"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<SubmitButton busy={busy} busyLabel="Unlocking…">
					Sign in
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
