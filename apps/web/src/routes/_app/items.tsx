import { Button } from "@mima/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@mima/ui/components/input-group";
import { Skeleton } from "@mima/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { cn } from "@mima/ui/lib/utils";
import { MagnifyingGlassIcon, PlusIcon, StarIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { z } from "zod";

import { ItemDetail } from "@/components/item-detail";
import { ItemDialog } from "@/components/item-dialog";
import { ItemTile } from "@/components/item-tile";
import { Page } from "@/components/page";
import { toneDot } from "@/lib/format";
import { useItems, useVaults } from "@/lib/vault-data";

const searchSchema = z.object({
	vault: z.string().optional(),
	kind: z.string().optional(),
	q: z.string().optional(),
	id: z.string().optional(),
	new: z.boolean().optional(),
});

export const Route = createFileRoute("/_app/items")({
	validateSearch: searchSchema,
	component: Items,
});

const kinds = [
	{ value: "all", label: "All" },
	{ value: "login", label: "Logins" },
	{ value: "api-key", label: "API keys" },
	{ value: "note", label: "Notes" },
	{ value: "ssh-key", label: "SSH keys" },
];

function Items() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const items = useItems();
	const vaults = useVaults();
	const vault = vaults.data?.find((v) => v.id === search.vault);
	const query = (search.q ?? "").toLowerCase();

	const inScope = (items.data ?? []).filter(
		(item) => !vault || item.vaultId === vault.id,
	);
	const visible = inScope.filter(
		(item) =>
			(!search.kind || item.kind === search.kind) &&
			(!query ||
				item.name.toLowerCase().includes(query) ||
				item.username?.toLowerCase().includes(query) ||
				item.url?.toLowerCase().includes(query) ||
				item.tags?.some((tag) => tag.toLowerCase().includes(query))),
	);
	const selected =
		visible.find((item) => item.id === search.id) ?? visible[0] ?? null;
	const setNew = (open: boolean) =>
		navigate({ search: (prev) => ({ ...prev, new: open || undefined }) });

	const description = vault
		? vault.personal
			? "Only you can open this vault."
			: `${vault.description ? `${vault.description} ` : ""}Shared with ${vault.members.length} ${vault.members.length === 1 ? "person" : "people"}.`
		: `${items.data?.length ?? 0} items across ${vaults.data?.length ?? 0} vaults.`;

	return (
		<Page
			wide
			title={vault ? vault.name : "All items"}
			description={description}
		>
			<div className="mb-3 flex items-center justify-between gap-3">
				<Tabs
					value={search.kind ?? "all"}
					onValueChange={(value) =>
						navigate({
							search: (prev) => ({
								...prev,
								kind: value === "all" ? undefined : String(value),
								id: undefined,
							}),
						})
					}
				>
					<TabsList>
						{kinds.map((k) => (
							<TabsTrigger key={k.value} value={k.value}>
								{k.label}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<div className="flex items-center gap-2">
					<InputGroup className="bg-surface w-64">
						<InputGroupAddon>
							<MagnifyingGlassIcon />
						</InputGroupAddon>
						<InputGroupInput
							placeholder="Search items"
							aria-label="Search items"
							value={search.q ?? ""}
							onChange={(event) =>
								navigate({
									search: (prev) => ({
										...prev,
										q: event.target.value || undefined,
										id: undefined,
									}),
									replace: true,
								})
							}
						/>
					</InputGroup>
					<Button onClick={() => setNew(true)}>
						<PlusIcon data-icon="inline-start" />
						New item
					</Button>
				</div>
			</div>

			{items.isPending ? (
				<div className="grid grid-cols-5 gap-3">
					<Skeleton className="rounded-window col-span-2 h-72" />
					<Skeleton className="rounded-window col-span-3 h-72" />
				</div>
			) : inScope.length === 0 ? (
				<EmptyVault onAdd={() => setNew(true)} vaultName={vault?.name} />
			) : (
				<div className="grid grid-cols-5 items-start gap-3">
					<section
						aria-label="Items"
						className="rounded-window bg-surface shadow-card col-span-2 flex flex-col gap-0.5 p-1.5"
					>
						{visible.length === 0 && (
							<p className="text-caption text-fg-subtle px-3 py-10 text-center">
								Nothing matches. Try another type or search.
							</p>
						)}
						{visible.map((item) => {
							const itemVault = vaults.data?.find((v) => v.id === item.vaultId);
							const active = selected?.id === item.id;
							return (
								<Link
									key={item.id}
									to="/items"
									search={(prev) => ({ ...prev, id: item.id })}
									aria-current={active ? "true" : undefined}
									className={cn(
										"flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
										active ? "bg-tint/6" : "hover:bg-tint/3",
									)}
								>
									<ItemTile kind={item.kind} />
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="text-body-sm text-fg flex items-center gap-1 truncate">
											{item.name}
											{item.favorite && (
												<StarIcon
													weight="fill"
													className="text-chart-3 size-3 shrink-0"
												/>
											)}
										</span>
										<span className="text-caption text-fg-subtle truncate">
											{item.username ?? item.url ?? item.notes ?? " "}
										</span>
									</div>
									{!vault && itemVault && (
										<span
											title={itemVault.name}
											className={`size-1.5 shrink-0 rounded-full ${toneDot[itemVault.tone]}`}
										/>
									)}
								</Link>
							);
						})}
					</section>
					<div className="col-span-3">
						{selected ? (
							<ItemDetail key={selected.id} item={selected} />
						) : (
							<div className="rounded-window border-line text-caption text-fg-subtle flex h-60 items-center justify-center border border-dashed">
								Select an item to see it here.
							</div>
						)}
					</div>
				</div>
			)}

			<ItemDialog
				open={Boolean(search.new)}
				onOpenChange={setNew}
				defaultVaultId={vault?.id}
				onSaved={(id) =>
					navigate({ search: (prev) => ({ ...prev, id, new: undefined }) })
				}
			/>
		</Page>
	);
}

function EmptyVault({
	onAdd,
	vaultName,
}: {
	onAdd: () => void;
	vaultName?: string;
}) {
	return (
		<div
			data-slot="empty-vault"
			className="rounded-window bg-surface shadow-card flex flex-col items-center gap-3 px-6 py-14 text-center"
		>
			<div data-slot="empty-tiles" className="mb-1">
				{(["login", "api-key", "ssh-key"] as const).map((kind, index) => (
					<ItemTile
						key={kind}
						kind={kind}
						size="lg"
						style={{ "--i": index } as CSSProperties}
					/>
				))}
			</div>
			<div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both flex flex-col gap-1 delay-200 duration-500">
				<h2 className="text-body text-fg">
					{vaultName ? `${vaultName} is empty` : "Nothing stored yet"}
				</h2>
				<p className="text-body-sm text-fg-muted max-w-sm">
					Add a login, an API key or a note. It's encrypted on this device
					before it's saved.
				</p>
			</div>
			<div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both delay-300 duration-500">
				<Button onClick={onAdd}>
					<PlusIcon data-icon="inline-start" />
					Add your first item
				</Button>
			</div>
		</div>
	);
}
