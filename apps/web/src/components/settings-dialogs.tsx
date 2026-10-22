import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import { WarningIcon } from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { backupFileName, toBackupCsv } from "@/lib/backup";
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
			description="Your items stay as they are: mima seals your keys again with the new password, on this device."
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
