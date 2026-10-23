import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mima/ui/components/dropdown-menu";
import { Skeleton } from "@mima/ui/components/skeleton";
import { DotsThreeIcon, TrashIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ItemTile } from "@/components/item-tile";
import { notify } from "@/components/notify";
import { Page } from "@/components/page";
import { ago, toneDot } from "@/lib/format";
import { logoDomain } from "@/lib/logos";
import {
	errorMessage,
	type Item,
	useActions,
	useDeletedItems,
	useMembers,
	useVaults,
} from "@/lib/vault-data";

export const Route = createFileRoute("/_app/deleted")({
	component: RecentlyDeleted,
	head: () => ({ meta: [{ title: "Recently deleted · mima" }] }),
});

const KEEP_DAYS = 30;

function RecentlyDeleted() {
	const items = useDeletedItems();
	const [purging, setPurging] = useState<Item | null>(null);
	const actions = useActions();

	return (
		<Page
			title="Recently deleted"
			description={`Deleted items wait here for ${KEEP_DAYS} days before they're gone for good. Anyone who can open the vault can bring them back.`}
		>
			{items.isPending ? (
				<Skeleton className="rounded-window h-40" />
			) : !items.data?.length ? (
				<div className="rounded-window border-line text-caption text-fg-subtle flex flex-col items-center gap-2 border border-dashed py-12">
					<TrashIcon className="size-5" />
					Nothing here. Items you delete show up for {KEEP_DAYS} days.
				</div>
			) : (
				<section
					aria-label="Deleted items"
					className="rounded-window bg-surface shadow-card divide-line-subtle flex flex-col divide-y"
				>
					{items.data.map((item) => (
						<DeletedRow key={item.id} item={item} onPurge={setPurging} />
					))}
				</section>
			)}

			<ConfirmDialog
				open={purging !== null}
				onOpenChange={(open) => !open && setPurging(null)}
				title={`Delete ${purging?.name} for good?`}
				description="It's removed for everyone right away and can't be brought back."
				confirm="Delete for good"
				destructive
				onConfirm={async () => {
					if (!purging) return;
					try {
						await actions.purgeItem(purging);
						notify.success(`${purging.name} is gone for good`);
					} catch (err) {
						notify.error("Couldn't delete it", errorMessage(err));
					}
				}}
			/>
		</Page>
	);
}

function DeletedRow({
	item,
	onPurge,
}: {
	item: Item;
	onPurge: (item: Item) => void;
}) {
	const actions = useActions();
	const vaults = useVaults();
	const members = useMembers();
	const [busy, setBusy] = useState(false);
	const vault = vaults.data?.find((v) => v.id === item.vaultId);
	const by = members.data?.members.find((m) => m.userId === item.deletedBy);
	const deletedAt = new Date(item.deletedAt ?? Date.now());
	const daysLeft = Math.max(
		1,
		KEEP_DAYS - Math.floor((Date.now() - deletedAt.getTime()) / 86_400_000),
	);

	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<ItemTile kind={item.kind} logo={logoDomain(item)} />
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="text-body-sm text-fg truncate">{item.name}</span>
				<span className="text-caption text-fg-subtle flex items-center gap-1.5 truncate">
					{vault && (
						<>
							<span
								className={`size-1.5 rounded-full ${toneDot[vault.tone]}`}
							/>
							<span>{vault.name}</span>
							<span aria-hidden>·</span>
						</>
					)}
					<span>
						Deleted {ago(deletedAt)}
						{by && ` by ${by.name}`}
					</span>
				</span>
			</div>
			<Badge variant={daysLeft <= 3 ? "warning" : "secondary"}>
				{daysLeft} {daysLeft === 1 ? "day" : "days"} left
			</Badge>
			<Button
				variant="outline"
				size="sm"
				disabled={busy}
				onClick={async () => {
					setBusy(true);
					try {
						await actions.restoreItem(item);
						notify.success(`Restored ${item.name}`, vault?.name);
					} catch (err) {
						notify.error("Couldn't restore it", errorMessage(err));
						setBusy(false);
					}
				}}
			>
				Restore
			</Button>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`More for ${item.name}`}
						/>
					}
				>
					<DotsThreeIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem variant="destructive" onClick={() => onPurge(item)}>
						<TrashIcon />
						Delete for good
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
