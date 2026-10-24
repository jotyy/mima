import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vauly/ui/components/dialog";
import { Input } from "@vauly/ui/components/input";
import { type FormEvent, useEffect, useState } from "react";
import { encode } from "uqr";

import { useKeyring } from "@/lib/keyring";
import { errorMessage } from "@/lib/vault-data";
import { client } from "@/utils/orpc";

import { Field, FormError } from "./auth-layout";
import { CopyButton } from "./copy-button";
import { notify } from "./notify";

type Setup = { secret: string; uri: string };

/**
 * Turns on two-step login: scan, confirm a code, then keep the recovery codes. With
 * `reloadWhenClosed`, the profile is loaded again only once the dialog closes: on the
 * screen that requires it, loading it sooner would take the codes away unread.
 */
export function TurnOnTwoStepDialog({
	open,
	onOpenChange: setOpen,
	reloadWhenClosed = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	reloadWhenClosed?: boolean;
}) {
	const keyring = useKeyring();
	const [setup, setSetup] = useState<Setup | null>(null);
	const [code, setCode] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
	const onOpenChange = (next: boolean) => {
		if (!next && recoveryCodes && reloadWhenClosed) {
			keyring.reloadMe().catch(() => {});
		}
		setOpen(next);
	};

	useEffect(() => {
		if (!open) return;
		setSetup(null);
		setCode("");
		setError("");
		setRecoveryCodes(null);
		client.account
			.beginTwoStep()
			.then(setSetup)
			.catch((err) => setError(errorMessage(err)));
	}, [open]);

	const confirm = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		try {
			const result = await client.account.confirmTwoStep({ code });
			setRecoveryCodes(result.recoveryCodes);
			if (!reloadWhenClosed) await keyring.reloadMe();
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	if (recoveryCodes) {
		const text = recoveryCodes.join("\n");
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Save your recovery codes</DialogTitle>
						<DialogDescription>
							Two-step login is on. If you lose your phone, each of these codes
							signs you in once instead of a code from the app. This is the only
							time vauly shows them.
						</DialogDescription>
					</DialogHeader>
					<ol
						aria-label="Recovery codes"
						className="bg-surface-sunken text-body-sm text-fg grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg px-4 py-3 font-mono"
					>
						{recoveryCodes.map((recovery) => (
							<li key={recovery}>{recovery}</li>
						))}
					</ol>
					<div className="flex gap-2">
						<Button
							variant="outline"
							onClick={() => {
								const link = document.createElement("a");
								link.href = URL.createObjectURL(
									new Blob([`vauly recovery codes\n\n${text}\n`], {
										type: "text/plain",
									}),
								);
								link.download = "vauly-recovery-codes.txt";
								link.click();
								URL.revokeObjectURL(link.href);
							}}
						>
							<DownloadSimpleIcon data-icon="inline-start" />
							Download
						</Button>
						<span className="border-line flex items-center rounded-lg border pr-1 pl-3">
							<span className="text-body-sm text-fg mr-1">Copy</span>
							<CopyButton value={text} label="recovery codes" />
						</span>
					</div>
					<DialogFooter>
						<Button
							onClick={() => {
								notify.success("Two-step login is on");
								onOpenChange(false);
							}}
						>
							I saved them
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Turn on two-step login</DialogTitle>
					<DialogDescription>
						Signing in will ask for a code from an authenticator app too, so a
						master password alone isn't enough. Turning it on signs out your
						other devices.
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={confirm} className="flex flex-col gap-4">
					<div className="flex items-start gap-4">
						<div className="shrink-0 rounded-lg bg-white p-2">
							{setup ? (
								<QrCode value={setup.uri} />
							) : (
								<div className="size-32" />
							)}
						</div>
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							<p className="text-body-sm text-fg">
								Scan this with an authenticator app, such as 1Password, Google
								Authenticator or Authy.
							</p>
							<p className="text-caption text-fg-muted">
								Can't scan? Enter this setup key instead:
							</p>
							<div className="border-line bg-surface-sunken flex items-center gap-1 rounded-lg border py-0.5 pr-0.5 pl-2.5">
								<code
									data-testid="setup-key"
									className="text-caption text-fg min-w-0 flex-1 truncate font-mono"
								>
									{setup?.secret ?? "…"}
								</code>
								{setup && (
									<CopyButton
										value={setup.secret}
										label="setup key"
										secret={false}
									/>
								)}
							</div>
						</div>
					</div>
					<Field label="Code from the app">
						<Input
							required
							autoComplete="one-time-code"
							inputMode="numeric"
							placeholder="123 456"
							className="font-mono tracking-widest"
							value={code}
							onChange={(event) => setCode(event.target.value)}
						/>
					</Field>
					<FormError>{error}</FormError>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || !setup}>
							{busy ? "Checking…" : "Turn on"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function TurnOffTwoStepDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const keyring = useKeyring();
	const [code, setCode] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setCode("");
			setError("");
		}
	}, [open]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Turn off two-step login?</DialogTitle>
					<DialogDescription>
						Your master password alone will sign you in again. Enter a code from
						your authenticator app, or a recovery code, to confirm.
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={async (event) => {
						event.preventDefault();
						setBusy(true);
						setError("");
						try {
							await client.account.disableTwoStep({ code });
							await keyring.reloadMe();
							notify.success("Two-step login is off");
							onOpenChange(false);
						} catch (err) {
							setError(errorMessage(err));
						} finally {
							setBusy(false);
						}
					}}
				>
					<Field label="Code">
						<Input
							required
							autoFocus
							autoComplete="one-time-code"
							className="font-mono tracking-widest"
							value={code}
							onChange={(event) => setCode(event.target.value)}
						/>
					</Field>
					<FormError>{error}</FormError>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" variant="destructive" disabled={busy}>
							Turn off
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** A QR code drawn as SVG squares, black on white so any camera reads it. */
function QrCode({ value }: { value: string }) {
	const { data, size } = encode(value, { ecc: "M" });
	const cells: string[] = [];
	data.forEach((row, y) => {
		row.forEach((dark, x) => {
			if (dark) cells.push(`M${x} ${y}h1v1h-1z`);
		});
	});
	return (
		<svg
			role="img"
			aria-label="QR code for your authenticator app"
			viewBox={`0 0 ${size} ${size}`}
			className="size-32"
			shapeRendering="crispEdges"
		>
			<path d={cells.join("")} fill="#000" />
		</svg>
	);
}
