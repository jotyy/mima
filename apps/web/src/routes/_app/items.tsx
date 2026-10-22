import { Button } from "@mima/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@mima/ui/components/input-group";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { cn } from "@mima/ui/lib/utils";
import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { ItemDetail } from "@/components/item-detail";
import { ItemTile } from "@/components/item-tile";
import { Page } from "@/components/page";
import { findVault, items, vaults } from "@/fixtures/vault";
import { toneDot } from "@/lib/format";

const searchSchema = z.object({
	vault: z.string().optional(),
	kind: z.string().optional(),
	q: z.string().optional(),
	id: z.string().optional(),
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
	const vault = vaults.find((v) => v.slug === search.vault);
	const query = (search.q ?? "").toLowerCase();

	const visible = items.filter(
		(item) =>
			(!vault || item.vaultId === vault.id) &&
			(!search.kind || item.kind === search.kind) &&
			(!query ||
				item.name.toLowerCase().includes(query) ||
				item.username?.toLowerCase().includes(query)),
	);
	const selected =
		visible.find((item) => item.id === search.id) ?? visible[0] ?? null;

	return (
		<Page
			wide
			title={vault ? vault.name : "All items"}
			description={
				vault
					? `${vault.description} ${visible.length} items.`
					: `${items.length} items across ${vaults.length} vaults.`
			}
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
					<Button>
						<PlusIcon data-icon="inline-start" />
						New item
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-5 items-start gap-3">
				<section className="rounded-window bg-surface shadow-card col-span-2 flex flex-col gap-0.5 p-1.5">
					{visible.length === 0 && (
						<p className="text-caption text-fg-subtle px-3 py-10 text-center">
							Nothing matches. Try another vault or search.
						</p>
					)}
					{visible.map((item) => {
						const itemVault = findVault(item.vaultId);
						const active = selected?.id === item.id;
						return (
							<Link
								key={item.id}
								to="/items"
								search={(prev) => ({ ...prev, id: item.id })}
								className={cn(
									"flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors",
									active ? "bg-tint/6" : "hover:bg-tint/3",
								)}
							>
								<ItemTile kind={item.kind} />
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="text-body-sm text-fg truncate">
										{item.name}
									</span>
									<span className="text-caption text-fg-subtle truncate">
										{item.username ?? item.notes ?? "—"}
									</span>
								</div>
								{!vault && itemVault && (
									<span
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
		</Page>
	);
}
