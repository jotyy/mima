import { WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Navigate,
	useNavigate,
} from "@tanstack/react-router";
import { Button } from "@vauly/ui/components/button";
import { Input } from "@vauly/ui/components/input";
import { useState } from "react";
import { z } from "zod";

import {
	AuthLayout,
	Field,
	FormError,
	PasswordInput,
	SubmitButton,
} from "@/components/auth-layout";
import Loader from "@/components/loader";
import { useKeyring } from "@/lib/keyring";
import { newMasterPasswordProblem } from "@/lib/secrets";
import { errorMessage, useWorkspace } from "@/lib/vault-data";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/join")({
	validateSearch: z.object({ token: z.string().default("") }),
	component: Join,
	head: () => ({ meta: [{ title: "Join your team · vauly" }] }),
});

function Join() {
	const { token } = Route.useSearch();
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const navigate = useNavigate();
	const invite = useQuery({
		queryKey: ["invite", token],
		queryFn: () => client.account.invite({ token }),
		enabled: token.length > 10,
		retry: false,
	});
	const [name, setName] = useState("");
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	if (keyring.status === "loading" || (invite.isPending && token.length > 10))
		return <Loader />;
	if (keyring.status === "unlocked") return <Navigate to="/" />;

	if (!invite.data) {
		return (
			<AuthLayout
				title="This invite doesn't work"
				description="It was used already or it expired. Ask for a new link."
			>
				<Button
					variant="brand"
					size="lg"
					className="h-10 w-full rounded-full"
					render={<Link to="/login" />}
				>
					Go to sign in
				</Button>
			</AuthLayout>
		);
	}

	const workspaceName = workspace.data?.workspaceName ?? "vauly";
	return (
		<AuthLayout
			title={`Join ${workspaceName}`}
			description={`${invite.data.invitedBy} invited ${invite.data.email}.`}
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError("");
					const problem = newMasterPasswordProblem(password, confirm);
					if (problem) return setError(problem);
					setBusy(true);
					try {
						await keyring.register({
							email: invite.data.email,
							name: name.trim(),
							password,
							inviteToken: token,
						});
						await navigate({ to: "/" });
					} catch (err) {
						setError(errorMessage(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Your name">
					<Input
						className="h-10"
						required
						autoFocus
						autoComplete="name"
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Field label="Master password">
					<PasswordInput
						className="h-10"
						required
						showStrength
						autoComplete="new-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<Field label="Repeat it">
					<PasswordInput
						className="h-10"
						required
						autoComplete="new-password"
						value={confirm}
						onChange={(event) => setConfirm(event.target.value)}
					/>
				</Field>
				<div className="border-warning-line bg-warning-soft text-caption text-warning flex gap-2 rounded-lg border px-3 py-2.5">
					<WarningIcon className="mt-px size-4 shrink-0" />
					Nobody can reset your master password. Store it somewhere safe.
				</div>
				<FormError>{error}</FormError>
				<SubmitButton busy={busy} busyLabel="Creating your keys…">
					{`Join ${workspaceName}`}
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
