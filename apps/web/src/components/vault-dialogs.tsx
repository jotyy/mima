import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { cn } from "@mima/ui/lib/utils";
import { CheckIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { initials, toneDot } from "@/lib/format";
import { useKeyring } from "@/lib/keyring";
import {
	errorMessage,
	type Tone,
	useActions,
	useMembers,
	type Vault,
} from "@/lib/vault-data";

import { Field } from "./auth-layout";
import { notify } from "./notify";

const tones: { value: Tone; label: string }[] = [
	{ value: "blue", label: "Blue" },
	{ value: "teal", label: "Teal" },
	{ value: "amber", label: "Amber" },
	{ value: "violet", label: "Violet" },
];

export function VaultDialog({
	open,
	onOpenChange,
	vault,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vault?: Vault;
	onSaved?: (id: string) => void;
}) {
	const actions = useActions();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [tone, setTone] = useState<Tone>("blue");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setName(vault?.name ?? "");
		setDescription(vault?.description ?? "");
		setTone(vault?.tone ?? "blue");
	}, [open, vault]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{vault ? `Edit ${vault.name}` : "New vault"}
					</DialogTitle>
					<DialogDescription>
						{vault
							? "The name and description are encrypted like everything else."
							: "Put items that the same people need together. You can add people after."}
					</DialogDescription>
				</DialogHeader>
				<form
					className="flex flex-col gap-3"
					onSubmit={async (event) => {
						event.preventDefault();
						if (!name.trim()) return;
						setBusy(true);
						const meta = {
							name: name.trim(),
							description: description.trim(),
							tone,
						};
						try {
							if (vault) {
								await actions.updateVault(vault, meta);
								notify.success("Saved", meta.name);
								onSaved?.(vault.id);
							} else {
								const { id } = await actions.createVault(meta);
								notify.success("Vault created", meta.name);
								onSaved?.(id);
							}
							onOpenChange(false);
						} catch (err) {
							notify.error("Couldn't save the vault", errorMessage(err));
						} finally {
							setBusy(false);
						}
					}}
				>
					<Field label="Name">
						<Input
							autoFocus
							required
							placeholder="Engineering"
							value={name}
							onChange={(event) => setName(event.target.value)}
						/>
					</Field>
					<Field label="Description">
						<Input
							placeholder="Databases, cloud accounts and API keys"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</Field>
					<fieldset className="flex flex-col gap-1.5">
						<legend className="text-caption text-fg-muted mb-1.5">Color</legend>
						<div className="flex gap-2">
							{tones.map((option) => (
								<button
									key={option.value}
									type="button"
									aria-label={option.label}
									aria-pressed={tone === option.value}
									onClick={() => setTone(option.value)}
									className={cn(
										"flex size-7 items-center justify-center rounded-full text-white transition-transform",
										toneDot[option.value],
										tone === option.value
											? "ring-fg ring-2 ring-offset-2"
											: "hover:scale-110",
									)}
								>
									{tone === option.value && (
										<CheckIcon weight="bold" className="size-3.5" />
									)}
								</button>
							))}
						</div>
					</fieldset>
					<DialogFooter>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy || !name.trim()}>
							{vault ? "Save" : "Create vault"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function VaultAccessDialog({
	vault,
	open,
	onOpenChange,
}: {
	vault: Vault;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { me } = useKeyring();
	const members = useMembers();
	const actions = useActions();
	const [adding, setAdding] = useState("");
	const [busy, setBusy] = useState(false);
	const inVault = new Set(vault.members.map((m) => m.userId));
	const others = (members.data?.members ?? []).filter(
		(m) => !inVault.has(m.userId),
	);
	const choices = others.map((m) => ({
		value: m.userId,
		label: `${m.name} · ${m.email}`,
	}));

	useEffect(() => {
		if (open) setAdding(others[0]?.userId ?? "");
	}, [open, others[0]?.userId]);

	const run = async (work: Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await work;
			notify.success(message);
		} catch (err) {
			notify.error("That didn't work", errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Who can open {vault.name}</DialogTitle>
					<DialogDescription>
						{vault.personal
							? "This is your private vault. Nobody else can be added."
							: "Adding someone wraps the vault key for them on this device. Removing them stops future access; change any secrets they've seen."}
					</DialogDescription>
				</DialogHeader>
				<ul className="flex flex-col gap-1">
					{vault.members.map((person) => (
						<li
							key={person.userId}
							className="flex items-center gap-2.5 rounded-lg px-1 py-1.5"
						>
							<Avatar size="sm">
								<AvatarFallback>{initials(person.name)}</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-1 flex-col">
								<span className="text-body-sm text-fg">
									{person.name}
									{person.userId === me?.id && (
										<span className="text-fg-subtle"> (you)</span>
									)}
								</span>
								<span className="text-caption text-fg-subtle truncate">
									{person.email}
								</span>
							</div>
							{!vault.personal && person.userId !== me?.id && (
								<Button
									variant="ghost"
									size="xs"
									disabled={busy}
									onClick={() =>
										run(
											actions.unshareVault(vault, person.userId),
											`${person.name} can't open ${vault.name} anymore`,
										)
									}
								>
									Remove
								</Button>
							)}
						</li>
					))}
				</ul>
				{!vault.personal &&
					(choices.length === 0 ? (
						<p className="text-caption text-fg-subtle">
							Everyone in the workspace can open this vault.
						</p>
					) : (
						<div className="flex gap-2">
							<Select
								items={choices}
								value={adding}
								onValueChange={(value) => value && setAdding(String(value))}
							>
								<SelectTrigger
									className="min-w-0 flex-1"
									aria-label="Person to add"
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{choices.map((choice) => (
										<SelectItem key={choice.value} value={choice.value}>
											{choice.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Button
								disabled={!adding || busy}
								onClick={() => {
									const person = others.find((m) => m.userId === adding);
									if (person) {
										run(
											actions.shareVault(vault, person),
											`${person.name} can open ${vault.name}`,
										);
									}
								}}
							>
								Give access
							</Button>
						</div>
					))}
			</DialogContent>
		</Dialog>
	);
}
