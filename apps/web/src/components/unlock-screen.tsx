import { FingerprintIcon } from "@phosphor-icons/react";
import { Avatar, AvatarFallback } from "@vauly/ui/components/avatar";
import { Button } from "@vauly/ui/components/button";
import { useState } from "react";

import { demoAccount } from "@/env.public";
import { initials } from "@/lib/format";
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
	const [password, setPassword] = useState(demoAccount?.password ?? "");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [waiting, setWaiting] = useState(false);

	const unlockWithPasskey = async () => {
		setWaiting(true);
		setError("");
		try {
			await keyring.unlockWithPasskey();
		} catch (err) {
			const cancelled =
				err instanceof DOMException &&
				(err.name === "NotAllowedError" || err.name === "AbortError");
			if (!cancelled) {
				setError(
					"The passkey didn't unlock vauly, so this device won't offer it again. Use your master password, and turn it back on in Settings.",
				);
			}
		} finally {
			setWaiting(false);
		}
	};

	return (
		<AuthLayout
			title={`Unlock ${workspace.data?.workspaceName ?? "vauly"}`}
			description={
				keyring.me && (
					<span className="bg-surface shadow-pill text-fg-emphasis mt-1 inline-flex max-w-full items-center gap-2 rounded-full py-1 pr-3 pl-1">
						<Avatar size="sm">
							<AvatarFallback>{initials(keyring.me.name)}</AvatarFallback>
						</Avatar>
						<span className="truncate">{keyring.me.email}</span>
					</span>
				)
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
			{keyring.deviceUnlock && (
				<div className="mb-4 flex flex-col gap-4">
					<Button
						type="button"
						variant="brand"
						size="lg"
						className="h-10 w-full rounded-full"
						disabled={waiting}
						onClick={unlockWithPasskey}
					>
						<FingerprintIcon data-icon="inline-start" />
						{waiting ? "Waiting for your passkey…" : "Unlock with passkey"}
					</Button>
					<p className="text-caption text-fg-subtle flex items-center gap-3">
						<span className="bg-line h-px flex-1" />
						or with your master password
						<span className="bg-line h-px flex-1" />
					</p>
				</div>
			)}
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
				<Field
					label="Master password"
					hint={
						demoAccount &&
						`The demo's master password is ${demoAccount.password}.`
					}
				>
					<PasswordInput
						className="h-10"
						autoFocus={!keyring.deviceUnlock}
						required
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<SubmitButton
					busy={busy}
					busyLabel="Unlocking…"
					variant={keyring.deviceUnlock ? "outline" : "brand"}
				>
					Unlock
				</SubmitButton>
			</form>
		</AuthLayout>
	);
}
