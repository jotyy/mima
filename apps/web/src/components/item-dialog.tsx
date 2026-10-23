import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import { Input } from "@mima/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { Textarea } from "@mima/ui/components/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import { cn } from "@mima/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	EyeIcon,
	EyeSlashIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";

import { generatePassword, parseTotp, passwordStrength } from "@/lib/secrets";
import {
	errorMessage,
	type Item,
	type ItemFields,
	type ItemKind,
	useActions,
	useVaults,
} from "@/lib/vault-data";

import { Morph } from "./morph";
import { notify } from "./notify";

const kinds: { value: ItemKind; label: string }[] = [
	{ value: "login", label: "Login" },
	{ value: "api-key", label: "API key" },
	{ value: "note", label: "Note" },
	{ value: "ssh-key", label: "SSH key" },
];

const secretLabel: Record<ItemKind, string> = {
	login: "Password",
	"api-key": "Value",
	note: "",
	"ssh-key": "Private key",
};

type Form = {
	kind: ItemKind;
	vaultId: string;
	name: string;
	username: string;
	secret: string;
	url: string;
	totp: string;
	notes: string;
	tags: string;
};

function fromItem(item?: Item, vaultId?: string): Form {
	return {
		kind: item?.kind ?? "login",
		vaultId: item?.vaultId ?? vaultId ?? "",
		name: item?.name ?? "",
		username: item?.username ?? "",
		secret: item?.secret ?? "",
		url: item?.url ?? "",
		totp: item?.totp ?? "",
		notes: item?.notes ?? "",
		tags: (item?.tags ?? []).join(", "),
	};
}

export function ItemDialog({
	open,
	onOpenChange,
	item,
	defaultVaultId,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	item?: Item;
	defaultVaultId?: string;
	onSaved?: (id: string) => void;
}) {
	const vaults = useVaults();
	const actions = useActions();
	const fallbackVault =
		defaultVaultId ??
		vaults.data?.find((v) => v.personal)?.id ??
		vaults.data?.[0]?.id;
	const [form, setForm] = useState(() => fromItem(item, fallbackVault));
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	// Fill the form when the dialog opens, or opens on another item. A background
	// refresh hands over a new `item` object, and mustn't wipe out what's being typed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only on open, see above
	useEffect(() => {
		if (open) {
			setForm(fromItem(item, fallbackVault));
			setError("");
		}
	}, [open, item?.id]);

	// The vaults may load after the dialog opened: pick the default one then.
	useEffect(() => {
		if (open && fallbackVault) {
			setForm((current) =>
				current.vaultId ? current : { ...current, vaultId: fallbackVault },
			);
		}
	}, [open, fallbackVault]);

	const set = <K extends keyof Form>(key: K, value: Form[K]) =>
		setForm((current) => ({ ...current, [key]: value }));

	const vaultItems = (vaults.data ?? []).map((v) => ({
		value: v.id,
		label: v.name,
	}));
	const showSecret = form.kind !== "note";

	const save = async () => {
		setError("");
		if (!form.name.trim()) return setError("Give it a name you'll recognize.");
		if (form.totp.trim() && !parseTotp(form.totp)) {
			return setError(
				"The one-time code needs a secret or an otpauth:// link.",
			);
		}
		const vault = vaults.data?.find((v) => v.id === form.vaultId);
		if (!vault) return setError("Pick a vault.");
		const fields: ItemFields = {
			kind: form.kind,
			name: form.name.trim(),
			...(form.username.trim() && { username: form.username.trim() }),
			...(showSecret && form.secret && { secret: form.secret }),
			...(form.kind === "login" &&
				form.url.trim() && { url: normalizeUrl(form.url.trim()) }),
			...(form.kind === "login" &&
				form.totp.trim() && { totp: form.totp.trim() }),
			...(form.notes.trim() && { notes: form.notes.trim() }),
			tags: form.tags
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean),
		};
		setBusy(true);
		try {
			if (item) {
				await actions.updateItem(item, fields, vault);
				notify.success("Saved", fields.name);
				onSaved?.(item.id);
			} else {
				const { id } = await actions.createItem(vault, fields);
				notify.success("Added", fields.name);
				onSaved?.(id);
			}
			onOpenChange(false);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{item ? `Edit ${item.name}` : "New item"}</DialogTitle>
				</DialogHeader>
				<form
					className="flex min-w-0 flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						save();
					}}
				>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Tabs
							className="max-w-full overflow-x-auto"
							value={form.kind}
							onValueChange={(value) => set("kind", value as ItemKind)}
						>
							<TabsList>
								{kinds.map((kind) => (
									<TabsTrigger key={kind.value} value={kind.value}>
										{kind.label}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
						<Select
							items={vaultItems}
							value={form.vaultId}
							onValueChange={(value) => value && set("vaultId", String(value))}
						>
							<SelectTrigger
								size="sm"
								className="w-36 max-sm:w-full"
								aria-label="Vault"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="end">
								{vaultItems.map((v) => (
									<SelectItem key={v.value} value={v.value}>
										{v.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<Morph layoutKey={form.kind} className="flex flex-col gap-4">
						<Row label="Name">
							<Input
								autoFocus
								required
								value={form.name}
								placeholder={
									form.kind === "login" ? "GitHub" : "Postgres · staging"
								}
								onChange={(event) => set("name", event.target.value)}
							/>
						</Row>
						{form.kind !== "note" && (
							<Row label="Username" optional={form.kind !== "login"}>
								<Input
									value={form.username}
									autoComplete="off"
									onChange={(event) => set("username", event.target.value)}
								/>
							</Row>
						)}
						{showSecret && (
							<Row label={secretLabel[form.kind]}>
								<SecretInput
									label={secretLabel[form.kind]}
									kind={form.kind}
									value={form.secret}
									onChange={(value) => set("secret", value)}
								/>
							</Row>
						)}
						{form.kind === "login" && (
							<div className="grid gap-4 md:grid-cols-2">
								<Row label="Website" optional>
									<Input
										value={form.url}
										placeholder="github.com"
										onChange={(event) => set("url", event.target.value)}
									/>
								</Row>
								<Row label="One-time code" optional>
									<Input
										value={form.totp}
										placeholder="Setup key or otpauth:// link"
										className="font-mono placeholder:font-sans"
										autoComplete="off"
										onChange={(event) => set("totp", event.target.value)}
									/>
								</Row>
							</div>
						)}
						<Row label="Notes" optional={form.kind !== "note"}>
							<Textarea
								value={form.notes}
								className={form.kind === "note" ? "min-h-32" : "min-h-16"}
								onChange={(event) => set("notes", event.target.value)}
							/>
						</Row>
						<Row label="Tags" optional>
							<Input
								value={form.tags}
								placeholder="work, billing"
								onChange={(event) => set("tags", event.target.value)}
							/>
						</Row>
						{error && (
							<p
								role="alert"
								className="border-danger-line bg-danger-soft text-caption text-danger-strong rounded-lg border px-3 py-2"
							>
								{error}
							</p>
						)}
					</Morph>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? "Encrypting…" : item ? "Save" : "Add item"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function normalizeUrl(value: string) {
	return /^[a-z]+:\/\//i.test(value) ? value : `https://${value}`;
}

/** A field with its label above it. "Optional" is visual only: the field isn't required. */
function Row({
	label,
	optional,
	children,
}: {
	label: string;
	optional?: boolean;
	children: ReactNode;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
		<label className="flex min-w-0 flex-col gap-1.5">
			<span className="text-caption flex items-baseline justify-between gap-2">
				<span className="text-fg-muted">{label}</span>
				{optional && (
					<span aria-hidden className="text-fg-subtle">
						Optional
					</span>
				)}
			</span>
			{children}
		</label>
	);
}

// The row's <label> also wraps the strength meter and buttons, so the field names
// itself rather than taking all of that text as its name.
function SecretInput({
	label,
	kind,
	value,
	onChange,
}: {
	label: string;
	kind: ItemKind;
	value: string;
	onChange: (value: string) => void;
}) {
	const [visible, setVisible] = useState(kind !== "login");
	if (kind === "ssh-key") {
		return (
			<Textarea
				aria-label={label}
				value={value}
				className="text-caption min-h-24 font-mono"
				placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
				onChange={(event) => onChange(event.target.value)}
			/>
		);
	}
	const strength = kind === "login" && value ? passwordStrength(value) : null;
	return (
		<>
			<div className="flex gap-1.5">
				<div className="relative flex-1">
					<Input
						aria-label={label}
						value={value}
						type={visible ? "text" : "password"}
						autoComplete="new-password"
						className="pr-9 font-mono"
						onChange={(event) => onChange(event.target.value)}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="absolute top-1/2 right-1 -translate-y-1/2"
						aria-label={visible ? "Hide" : "Show"}
						onClick={() => setVisible((shown) => !shown)}
					>
						{visible ? <EyeSlashIcon /> : <EyeIcon />}
					</Button>
				</div>
				{kind === "login" && (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="outline"
									size="icon"
									aria-label="Generate a password"
									onClick={() => {
										onChange(generatePassword());
										setVisible(true);
									}}
								/>
							}
						>
							<ArrowsClockwiseIcon />
						</TooltipTrigger>
						<TooltipContent>Generate a strong password</TooltipContent>
					</Tooltip>
				)}
			</div>
			{strength && (
				<span
					className={cn(
						"text-caption",
						strength === "weak" && "text-danger",
						strength === "fair" && "text-warning",
						strength === "strong" && "text-success",
					)}
				>
					{strength === "weak"
						? "Weak: easy to guess"
						: strength === "fair"
							? "Fair: longer is better"
							: "Strong"}
				</span>
			)}
		</>
	);
}
