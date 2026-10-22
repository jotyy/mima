import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import { cn } from "@mima/ui/lib/utils";
import { FileCsvIcon, WarningIcon } from "@phosphor-icons/react";
import { type DragEvent, useEffect, useId, useState } from "react";
import { plural } from "@/lib/format";
import {
	ImportError,
	type ParsedImport,
	parseImport,
	sameItem,
} from "@/lib/import";
import {
	errorMessage,
	type ItemFields,
	useActions,
	useItems,
	useVaults,
} from "@/lib/vault-data";

import { ItemTile } from "./item-tile";
import { notify } from "./notify";

const sources = [
	"1Password",
	"Bitwarden",
	"LastPass",
	"Chrome",
	"Firefox",
	"Safari",
];

type Step =
	| { name: "pick"; error?: string }
	| { name: "review"; file: string; parsed: ParsedImport }
	| { name: "saving"; done: number; total: number };

/**
 * Brings in a CSV export from another password manager or a browser. The file is read
 * and encrypted on this device; only ciphertext reaches the server.
 */
export function ImportDialog({
	open,
	onOpenChange,
	defaultVaultId,
	onImported,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	defaultVaultId?: string;
	onImported?: (vaultId: string) => void;
}) {
	const vaults = useVaults();
	const items = useItems();
	const actions = useActions();
	const [step, setStep] = useState<Step>({ name: "pick" });
	const fallbackVault =
		defaultVaultId ??
		vaults.data?.find((v) => v.personal)?.id ??
		vaults.data?.[0]?.id ??
		"";
	const [vaultId, setVaultId] = useState(fallbackVault);

	useEffect(() => {
		if (open) {
			setStep({ name: "pick" });
			setVaultId(fallbackVault);
		}
	}, [open, fallbackVault]);

	const read = async (file: File) => {
		try {
			const parsed = parseImport(await file.text());
			if (parsed.items.length === 0) {
				setStep({
					name: "pick",
					error: "That file has no logins or notes mima can import.",
				});
				return;
			}
			setStep({ name: "review", file: file.name, parsed });
		} catch (err) {
			setStep({
				name: "pick",
				error:
					err instanceof ImportError
						? err.message
						: "That file couldn't be read. Export it again as CSV.",
			});
		}
	};

	const vault = vaults.data?.find((v) => v.id === vaultId);
	const existing = (items.data ?? []).filter((i) => i.vaultId === vaultId);
	const fresh =
		step.name === "review"
			? step.parsed.items.filter(
					(candidate) => !existing.some((item) => sameItem(item, candidate)),
				)
			: [];

	const save = async (toSave: ItemFields[]) => {
		if (!vault) return;
		setStep({ name: "saving", done: 0, total: toSave.length });
		try {
			await actions.importItems(vault, toSave, (done) =>
				setStep({ name: "saving", done, total: toSave.length }),
			);
			notify.success(
				`Imported ${toSave.length} ${toSave.length === 1 ? "item" : "items"} into ${vault.name}`,
				"Now delete the CSV file: it holds your passwords in plain text.",
			);
			onOpenChange(false);
			onImported?.(vault.id);
		} catch (err) {
			notify.error("The import stopped", errorMessage(err));
			onOpenChange(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => step.name !== "saving" && onOpenChange(next)}
		>
			<DialogContent
				className="sm:max-w-lg"
				showCloseButton={step.name !== "saving"}
			>
				<DialogHeader>
					<DialogTitle>Import items</DialogTitle>
					<DialogDescription>
						Export a CSV from your old password manager or browser. mima reads
						it on this device and encrypts every item before it's saved.
					</DialogDescription>
				</DialogHeader>

				{step.name === "pick" && <PickFile onFile={read} error={step.error} />}

				{step.name === "review" && (
					<Review
						file={step.file}
						parsed={step.parsed}
						fresh={fresh}
						vaultId={vaultId}
						onVaultChange={setVaultId}
					/>
				)}

				{step.name === "saving" && (
					<div className="flex flex-col gap-2 py-4" role="status">
						<div className="text-body-sm text-fg flex justify-between">
							<span>Encrypting and saving…</span>
							<span className="text-fg-muted tabular-nums">
								{step.done} of {step.total}
							</span>
						</div>
						<div className="bg-surface-sunken h-1.5 overflow-hidden rounded-full">
							<div
								className="bg-brand h-full rounded-full transition-all duration-300"
								style={{ width: `${(step.done / step.total) * 100}%` }}
							/>
						</div>
					</div>
				)}

				{step.name === "review" && (
					<DialogFooter>
						<Button variant="ghost" onClick={() => setStep({ name: "pick" })}>
							Choose another file
						</Button>
						<Button
							disabled={fresh.length === 0 || !vault}
							onClick={() => save(fresh)}
						>
							Import {fresh.length} {fresh.length === 1 ? "item" : "items"}
						</Button>
					</DialogFooter>
				)}
			</DialogContent>
		</Dialog>
	);
}

function PickFile({
	onFile,
	error,
}: {
	onFile: (file: File) => void;
	error?: string;
}) {
	const id = useId();
	const [over, setOver] = useState(false);
	const drop = (event: DragEvent) => {
		event.preventDefault();
		setOver(false);
		const file = event.dataTransfer.files[0];
		if (file) onFile(file);
	};

	return (
		<div className="flex flex-col gap-3">
			<label
				htmlFor={id}
				onDragOver={(event) => {
					event.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={drop}
				className={cn(
					"border-line hover:border-line-strong hover:bg-tint/2 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
					over && "border-brand bg-brand-soft hover:border-brand",
				)}
			>
				<span className="bg-brand-soft text-brand flex size-10 items-center justify-center rounded-full">
					<FileCsvIcon className="size-5" />
				</span>
				<span className="text-body-sm text-fg">
					Drop a CSV file here, or <span className="text-link">choose one</span>
				</span>
				<span className="text-caption text-fg-subtle">
					{sources.join(" · ")} · any CSV with a password column
				</span>
				<input
					id={id}
					type="file"
					accept=".csv,text/csv"
					aria-label="CSV file"
					className="sr-only"
					onChange={(event) => {
						const file = event.target.files?.[0];
						if (file) onFile(file);
						event.target.value = "";
					}}
				/>
			</label>
			{error && (
				<p
					role="alert"
					className="border-danger-line bg-danger-soft text-caption text-danger-strong rounded-lg border px-3 py-2"
				>
					{error}
				</p>
			)}
		</div>
	);
}

function Review({
	file,
	parsed,
	fresh,
	vaultId,
	onVaultChange,
}: {
	file: string;
	parsed: ParsedImport;
	fresh: ItemFields[];
	vaultId: string;
	onVaultChange: (id: string) => void;
}) {
	const vaults = useVaults();
	const choices = (vaults.data ?? []).map((v) => ({
		value: v.id,
		label: v.name,
	}));
	const duplicates = parsed.items.length - fresh.length;
	const logins = fresh.filter((item) => item.kind === "login").length;
	const notes = fresh.length - logins;

	return (
		<div className="flex flex-col gap-3">
			<div className="border-line flex items-center gap-3 rounded-lg border px-3 py-2.5">
				<FileCsvIcon className="text-fg-muted size-5 shrink-0" />
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="text-body-sm text-fg truncate">{file}</span>
					<span className="text-caption text-fg-muted">
						{parsed.source === "CSV" ? "CSV" : `${parsed.source} export`} ·{" "}
						{plural(logins, "login")}
						{notes > 0 && `, ${plural(notes, "note")}`}
					</span>
				</div>
				<Select
					items={choices}
					value={vaultId}
					onValueChange={(value) => value && onVaultChange(String(value))}
				>
					<SelectTrigger size="sm" className="w-36" aria-label="Vault">
						<SelectValue />
					</SelectTrigger>
					<SelectContent align="end">
						{choices.map((choice) => (
							<SelectItem key={choice.value} value={choice.value}>
								{choice.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{fresh.length > 0 && (
				<ul
					aria-label="Items to import"
					className="border-line-subtle divide-line-subtle flex max-h-60 flex-col divide-y overflow-y-auto rounded-lg border"
				>
					{fresh.map((item, index) => (
						<li
							// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id until they're saved
							key={index}
							className="flex items-center gap-2.5 px-3 py-2"
						>
							<ItemTile kind={item.kind} />
							<span className="text-body-sm text-fg min-w-0 flex-1 truncate">
								{item.name}
							</span>
							<span className="text-caption text-fg-subtle max-w-48 truncate">
								{item.username ?? item.url ?? ""}
							</span>
						</li>
					))}
				</ul>
			)}

			{(duplicates > 0 || parsed.skipped > 0) && (
				<ul className="text-caption text-fg-muted flex flex-col gap-1">
					{duplicates > 0 && (
						<li>
							{plural(duplicates, "item")} already in this vault{" "}
							{duplicates === 1 ? "is" : "are"} left out.
						</li>
					)}
					{parsed.skipped > 0 && (
						<li>
							{plural(parsed.skipped, "row")} with no password or note, or a
							card or identity, {parsed.skipped === 1 ? "is" : "are"} skipped.
						</li>
					)}
				</ul>
			)}

			<p className="border-warning-line bg-warning-soft text-caption text-warning flex gap-2 rounded-lg border px-3 py-2.5">
				<WarningIcon className="mt-px size-4 shrink-0" />
				Delete the CSV file once the import is done. It holds your passwords in
				plain text.
			</p>
		</div>
	);
}
