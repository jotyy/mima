import { FingerprintIcon, WarningIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vauly/ui/components/dialog";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

import { backupFileName, toBackupCsv } from "@/lib/backup";
import {
	DeviceUnlockUnavailable,
	type Enrolment,
	isCancel,
} from "@/lib/device-unlock";
import { useKeyring, WrongPasswordError } from "@/lib/keyring";
import { newMasterPasswordProblem } from "@/lib/secrets";
import { errorMessage, useItems, useVaults } from "@/lib/vault-data";
import { client } from "@/utils/orpc";

import { Field, FormError, PasswordInput } from "./auth-layout";
import { notify } from "./notify";

export function ChangePasswordDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const keyring = useKeyring();
	const [form, setForm] = useState({ current: "", next: "", repeat: "" });
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const set =
		(key: keyof typeof form) => (event: { target: { value: string } }) =>
			setForm((value) => ({ ...value, [key]: event.target.value }));

	useEffect(() => {
		if (open) {
			setForm({ current: "", next: "", repeat: "" });
			setError("");
		}
	}, [open]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError("");
		const problem = newMasterPasswordProblem(form.next, form.repeat);
		if (problem) return setError(problem);
		if (form.next === form.current) {
			return setError(
				"The new master password is the same as the current one.",
			);
		}
		setBusy(true);
		try {
			await keyring.changePassword(form.current, form.next);
			notify.success(
				"Master password changed",
				"Other devices were signed out. Use the new one from now on.",
			);
			onOpenChange(false);
		} catch (err) {
			setError(
				err instanceof WrongPasswordError
					? "The current master password is wrong."
					: errorMessage(err),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<FormDialog
			open={open}
			onOpenChange={(next) => !busy && onOpenChange(next)}
			title="Change master password"
			description="Your items stay as they are: vauly seals your keys again with the new password, on this device."
			onSubmit={submit}
			footer={
				<>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy}>
						{busy ? "Changing…" : "Change master password"}
					</Button>
				</>
			}
		>
			<Field label="Current master password">
				<PasswordInput
					required
					autoFocus
					autoComplete="current-password"
					value={form.current}
					onChange={set("current")}
				/>
			</Field>
			<Field label="New master password">
				<PasswordInput
					required
					showStrength
					autoComplete="new-password"
					value={form.next}
					onChange={set("next")}
				/>
			</Field>
			<Field label="Repeat the new one">
				<PasswordInput
					required
					autoComplete="new-password"
					value={form.repeat}
					onChange={set("repeat")}
				/>
			</Field>
			<FormError>{error}</FormError>
		</FormDialog>
	);
}

/**
 * Turns on unlocking with a passkey on this device: the master password, then a tap to
 * create the passkey, and on some devices one more to use it once. Each passkey prompt
 * starts right in its tap, which Safari insists on.
 */
export function DeviceUnlockDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const keyring = useKeyring();
	const [step, setStep] = useState<"password" | "create" | "confirm">(
		"password",
	);
	const enrolment = useRef<Enrolment | null>(null);
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setStep("password");
			setPassword("");
			setError("");
		} else {
			enrolment.current?.cancel();
			enrolment.current = null;
		}
	}, [open]);

	const done = () => {
		notify.success(
			"This device unlocks with a passkey now",
			"For 14 days at a time. Signing in still needs your master password.",
		);
		onOpenChange(false);
	};

	const failed = (err: unknown) => {
		if (isCancel(err)) {
			setError(
				"The passkey didn't go through. Try again, and confirm with Face ID, Touch ID, Windows Hello or your device's PIN.",
			);
			return;
		}
		// Anything else ends this attempt; it starts again from the master password.
		enrolment.current = null;
		setStep("password");
		setPassword("");
		setError(
			err instanceof DeviceUnlockUnavailable ? err.message : errorMessage(err),
		);
	};

	/** Runs `work` straight from the tap, so its passkey prompt counts as the tap's. */
	const act = (work: () => Promise<void>) => {
		setBusy(true);
		setError("");
		work()
			.catch(failed)
			.finally(() => setBusy(false));
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError("");
		setBusy(true);
		try {
			enrolment.current = await keyring.startDeviceUnlock(password);
			setPassword("");
			setStep("create");
		} catch (err) {
			setError(
				err instanceof WrongPasswordError
					? "That's not your master password."
					: errorMessage(err),
			);
		} finally {
			setBusy(false);
		}
	};

	const close = (
		<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
			Cancel
		</Button>
	);

	return (
		<FormDialog
			open={open}
			onOpenChange={(next) => !busy && onOpenChange(next)}
			title="Unlock with this device"
			description={
				step === "password"
					? "Enter your master password. Then your device asks for Face ID, Touch ID, Windows Hello or its PIN."
					: step === "create"
						? "Now create the passkey. vauly keeps a copy of your keys on this device that only it opens, for 14 days at a time."
						: "Use the new passkey once, so vauly can seal the copy of your keys with it."
			}
			onSubmit={submit}
			footer={
				step === "password" ? (
					<>
						{close}
						<Button type="submit" disabled={busy}>
							{busy ? "Checking…" : "Continue"}
						</Button>
					</>
				) : (
					<>
						{close}
						<Button
							type="button"
							disabled={busy}
							onClick={() =>
								act(async () => {
									const current = enrolment.current;
									if (!current) return;
									if (step === "confirm") {
										await current.confirm();
										return done();
									}
									const next = await current.create();
									if (next === "done") done();
									else setStep("confirm");
								})
							}
						>
							<FingerprintIcon data-icon="inline-start" />
							{busy
								? "Waiting for your passkey…"
								: step === "create"
									? "Create passkey"
									: "Confirm with passkey"}
						</Button>
					</>
				)
			}
		>
			{step === "password" && (
				<Field label="Master password">
					<PasswordInput
						required
						autoFocus
						autoComplete="current-password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
			)}
			<FormError>{error}</FormError>
		</FormDialog>
	);
}

/** Asks for the master password again, then saves every item the person can open. */
export function ExportDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const keyring = useKeyring();
	const items = useItems();
	const vaults = useVaults();
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const count = items.data?.length ?? 0;

	useEffect(() => {
		if (open) {
			setPassword("");
			setError("");
		}
	}, [open]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setError("");
		setBusy(true);
		try {
			if (!(await keyring.verifyPassword(password))) {
				setError("That's not your master password.");
				return;
			}
			const names = new Map((vaults.data ?? []).map((v) => [v.id, v.name]));
			const csv = toBackupCsv(
				(items.data ?? []).map((item) => ({
					vault: names.get(item.vaultId) ?? "",
					favorite: item.favorite,
					kind: item.kind,
					name: item.name,
					username: item.username,
					secret: item.secret,
					url: item.url,
					totp: item.totp,
					notes: item.notes,
					tags: item.tags,
				})),
			);
			const file = backupFileName();
			download(file, csv);
			await client.account.exported({ count });
			notify.success(
				"Backup downloaded",
				`${count} ${count === 1 ? "item" : "items"} in ${file}. It isn't encrypted, so keep it somewhere safe.`,
			);
			onOpenChange(false);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<FormDialog
			open={open}
			onOpenChange={(next) => !busy && onOpenChange(next)}
			title="Download a backup"
			description={`All ${count} ${count === 1 ? "item" : "items"} you can open, in one CSV file. Your team sees in the activity log that you made one.`}
			onSubmit={submit}
			footer={
				<>
					<Button
						type="button"
						variant="ghost"
						onClick={() => onOpenChange(false)}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy || count === 0}>
						{busy ? "Preparing…" : "Download backup"}
					</Button>
				</>
			}
		>
			<p className="border-warning-line bg-warning-soft text-caption text-warning flex gap-2 rounded-lg border px-3 py-2.5">
				<WarningIcon className="mt-px size-4 shrink-0" />
				The file holds every password in plain text. Store it encrypted, or
				delete it once you're done.
			</p>
			<Field label="Master password">
				<PasswordInput
					required
					autoFocus
					autoComplete="current-password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			</Field>
			<FormError>{error}</FormError>
		</FormDialog>
	);
}

function FormDialog({
	open,
	onOpenChange,
	title,
	description,
	onSubmit,
	footer,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	onSubmit: (event: FormEvent) => void;
	footer: ReactNode;
	children: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={onSubmit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
					{children}
					<DialogFooter>{footer}</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function download(name: string, contents: string) {
	const url = URL.createObjectURL(
		new Blob([contents], { type: "text/csv;charset=utf-8" }),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
