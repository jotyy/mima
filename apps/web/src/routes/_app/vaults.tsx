import {
	DotsThreeIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
} from "@vauly/ui/components/avatar";
import { Badge } from "@vauly/ui/components/badge";
import { Button } from "@vauly/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vauly/ui/components/dropdown-menu";
import { Skeleton } from "@vauly/ui/components/skeleton";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { notify } from "@/components/notify";
import { Page } from "@/components/page";
import { VaultAccessDialog, VaultDialog } from "@/components/vault-dialogs";
import { initials, plural, toneDot } from "@/lib/format";
import {
	canManage,
	errorMessage,
	useActions,
	useAgents,
	useItems,
	useVaults,
	type Vault,
} from "@/lib/vault-data";

export const Route = createFileRoute("/_app/vaults")({
	component: Vaults,
	head: () => ({ meta: [{ title: "Vaults · vauly" }] }),
});

function Vaults() {
	const vaults = useVaults();
	const navigate = useNavigate();
	const [creating, setCreating] = useState(false);
	const sorted = [...(vaults.data ?? [])].sort(
		(a, b) =>
			Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name),
	);

	return (
		<Page
			title="Vaults"
			description="Group items and choose who can open them."
		>
			{vaults.isPending ? (
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<Skeleton className="rounded-window h-40" />
					<Skeleton className="rounded-window h-40" />
				</div>
			) : (
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					{sorted.map((vault) => (
						<VaultCard key={vault.id} vault={vault} />
					))}
					<button
						type="button"
						onClick={() => setCreating(true)}
						className="rounded-window border-line text-caption text-fg-muted hover:border-line-strong hover:text-fg flex min-h-40 flex-col items-center justify-center gap-2 border border-dashed transition-colors"
					>
						<PlusIcon className="size-4" />
						New vault
					</button>
				</div>
			)}
			<VaultDialog
				open={creating}
				onOpenChange={setCreating}
				onSaved={(id) => navigate({ to: "/items", search: { vault: id } })}
			/>
		</Page>
	);
}

function VaultCard({ vault }: { vault: Vault }) {
	const items = useItems();
	const agents = useAgents();
	const actions = useActions();
	const [editing, setEditing] = useState(false);
	const [sharing, setSharing] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const itemIds = new Set(
		(items.data ?? [])
			.filter((item) => item.vaultId === vault.id)
			.map((item) => item.id),
	);
	const agentCount = (agents.data ?? []).filter((agent) =>
		agent.grants.some((grant) => itemIds.has(grant.itemId)),
	).length;

	return (
		<article className="group/vault rounded-window bg-surface shadow-card hover:shadow-popover relative flex flex-col p-3.5 transition-shadow">
			<Link
				to="/items"
				search={{ vault: vault.id }}
				aria-label={`Open ${vault.name}`}
				className="rounded-window absolute inset-0"
			/>
			<div className="flex items-center gap-2">
				<span className={`size-2 rounded-full ${toneDot[vault.tone]}`} />
				<h2 className="text-body-sm text-fg flex-1 font-medium">
					{vault.name}
				</h2>
				{vault.personal && <Badge variant="secondary">Private</Badge>}
				{vault.role === "view" && <Badge variant="secondary">View only</Badge>}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-xs"
								className="relative z-10"
								aria-label={`${vault.name} options`}
							/>
						}
					>
						<DotsThreeIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-48">
						{!vault.personal && (
							<DropdownMenuItem onClick={() => setSharing(true)}>
								<UsersThreeIcon />
								{canManage(vault) ? "Manage access" : "People"}
							</DropdownMenuItem>
						)}
						{canManage(vault) && (
							<DropdownMenuItem onClick={() => setEditing(true)}>
								<PencilSimpleIcon />
								Rename
							</DropdownMenuItem>
						)}
						{!vault.personal && canManage(vault) && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={() => setDeleting(true)}
								>
									<TrashIcon />
									Delete vault
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<p className="text-caption text-fg-subtle mt-1.5 min-h-4">
				{vault.description ||
					(vault.personal ? "Only you can open this vault." : " ")}
			</p>
			<div className="mt-5 flex items-end justify-between">
				<div className="flex gap-6">
					<Figure
						value={vault.itemCount}
						label={vault.itemCount === 1 ? "item" : "items"}
					/>
					{agentCount > 0 && (
						<Figure
							value={agentCount}
							label={agentCount === 1 ? "agent" : "agents"}
						/>
					)}
				</div>
				<button
					type="button"
					disabled={vault.personal}
					onClick={() => setSharing(true)}
					aria-label={`People who can open ${vault.name}`}
					className="relative z-10 rounded-full disabled:cursor-default"
				>
					<AvatarGroup>
						{vault.members.slice(0, 5).map((person) => (
							<Avatar key={person.userId} size="sm">
								<AvatarFallback>{initials(person.name)}</AvatarFallback>
							</Avatar>
						))}
					</AvatarGroup>
				</button>
			</div>

			<VaultDialog open={editing} onOpenChange={setEditing} vault={vault} />
			<VaultAccessDialog
				vault={vault}
				open={sharing}
				onOpenChange={setSharing}
			/>
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${vault.name}?`}
				description={`Its ${plural(vault.itemCount, "item")} ${vault.itemCount === 1 ? "is" : "are"} deleted for everyone, and agents lose access to them. This can't be undone.`}
				confirm="Delete vault"
				destructive
				onConfirm={async () => {
					try {
						await actions.deleteVault(vault);
						notify.success(`Deleted ${vault.name}`);
					} catch (err) {
						notify.error("Couldn't delete the vault", errorMessage(err));
					}
				}}
			/>
		</article>
	);
}

function Figure({ value, label }: { value: number; label: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-fg text-stat tabular-nums">{value}</span>
			<span className="text-caption text-fg-subtle mt-1.5">{label}</span>
		</div>
	);
}
