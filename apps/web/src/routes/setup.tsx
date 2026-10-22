import { Input } from "@mima/ui/components/input";
import { WarningIcon } from "@phosphor-icons/react";
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
import { useKeyring } from "@/lib/keyring";
import { newMasterPasswordProblem } from "@/lib/secrets";
import { errorMessage, useWorkspace } from "@/lib/vault-data";

export const Route = createFileRoute("/setup")({
	component: Setup,
});

function Setup() {
	const keyring = useKeyring();
	const workspace = useWorkspace();
	const navigate = useNavigate();
	const [form, setForm] = useState({
		workspace: "",
		name: "",
		email: "",
		password: "",
		confirm: "",
	});
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const set =
		(key: keyof typeof form) => (event: { target: { value: string } }) =>
			setForm((current) => ({ ...current, [key]: event.target.value }));

	if (keyring.status === "loading" || workspace.isPending) return <Loader />;
	if (keyring.status !== "signed-out") return <Navigate to="/" />;
	if (workspace.data?.hasOwner) return <Navigate to="/login" />;

	return (
		<AuthLayout
			title="Create your workspace"
			description="You'll be its owner. Invite your team once you're in."
		>
			<form
				className="flex flex-col gap-4"
				onSubmit={async (event) => {
					event.preventDefault();
					setError("");
					const problem = newMasterPasswordProblem(form.password, form.confirm);
					if (problem) return setError(problem);
					setBusy(true);
					try {
						await keyring.register({
							email: form.email.trim(),
							name: form.name.trim(),
							password: form.password,
							workspaceName: form.workspace.trim(),
						});
						await workspace.refetch();
						await navigate({ to: "/" });
					} catch (err) {
						setError(errorMessage(err));
					} finally {
						setBusy(false);
					}
				}}
			>
				<Field label="Workspace name">
					<Input
						className="h-10"
						required
						autoFocus
						placeholder="Acme"
						value={form.workspace}
						onChange={set("workspace")}
					/>
				</Field>
				<Field label="Your name">
					<Input
						className="h-10"
						required
						autoComplete="name"
						value={form.name}
						onChange={set("name")}
					/>
				</Field>
				<Field label="Email">
					<Input
						className="h-10"
						required
						type="email"
						autoComplete="username"
						value={form.email}
						onChange={set("email")}
					/>
				</Field>
				<Field label="Master password">
					<PasswordInput
						className="h-10"
						required
						showStrength
						autoComplete="new-password"
						value={form.password}
						onChange={set("password")}
					/>
				</Field>
				<Field label="Repeat it">
					<PasswordInput
						className="h-10"
						required
						autoComplete="new-password"
						value={form.confirm}
						onChange={set("confirm")}
					/>
				</Field>
				<div className="border-warning-line bg-warning-soft text-caption text-warning flex gap-2 rounded-lg border px-3 py-2.5">
					<WarningIcon className="mt-px size-4 shrink-0" />
					Nobody can reset your master password, including us. If you forget it,
					your items can't be recovered.
				</div>
				<FormError>{error}</FormError>
				<SubmitButton busy={busy} busyLabel="Creating your keys…">
					Create workspace
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
