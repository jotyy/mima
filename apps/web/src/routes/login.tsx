import { Button } from "@mima/ui/components/button";
import { Input } from "@mima/ui/components/input";
import { FingerprintIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { MimaMark } from "@/components/mima-mark";
import { currentMemberId, findMember, workspace } from "@/fixtures/vault";

export const Route = createFileRoute("/login")({
	component: Unlock,
});

function Unlock() {
	const navigate = useNavigate();
	const me = findMember(currentMemberId);
	const unlock = () => navigate({ to: "/" });

	return (
		<div className="bg-frame flex min-h-svh flex-col items-center justify-center px-4">
			<div className="rounded-window bg-surface shadow-card w-full max-w-sm p-6">
				<div className="flex flex-col items-center gap-3 text-center">
					<MimaMark className="text-h5 size-9 rounded-lg" />
					<div className="flex flex-col gap-1">
						<h1 className="text-fg text-h5">Unlock {workspace.name}</h1>
						<p className="text-body-sm text-fg-muted">{me?.email}</p>
					</div>
				</div>
				<Button size="lg" className="mt-6 w-full" onClick={unlock}>
					<FingerprintIcon data-icon="inline-start" />
					Unlock with passkey
				</Button>
				<div className="text-caption text-fg-subtle my-5 flex items-center gap-3">
					<span className="bg-line-subtle h-px flex-1" />
					or use your master password
					<span className="bg-line-subtle h-px flex-1" />
				</div>
				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						unlock();
					}}
				>
					<Input
						type="password"
						autoComplete="current-password"
						placeholder="Master password"
						aria-label="Master password"
						className="font-mono"
					/>
					<Button type="submit" variant="outline" className="w-full">
						Unlock
					</Button>
				</form>
				<button
					type="button"
					className="text-caption text-fg-muted decoration-fg/25 hover:text-fg mx-auto mt-5 block underline-offset-4 hover:underline"
				>
					Lost access? Use your recovery kit
				</button>
			</div>
			<p className="text-caption text-fg-subtle mt-4 flex items-center gap-1.5">
				<LockSimpleIcon className="size-3.5" />
				End-to-end encrypted. Your master password never leaves this device.
			</p>
		</div>
	);
}
