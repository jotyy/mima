import { Button } from "@mima/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@mima/ui/components/input-group";
import { Skeleton } from "@mima/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { cn } from "@mima/ui/lib/utils";
import {
	LockSimpleIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	StarIcon,
	UploadSimpleIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { z } from "zod";
import { ImportDialog } from "@/components/import-dialog";
import { ItemDetail } from "@/components/item-detail";
import { ItemDialog } from "@/components/item-dialog";
import { ItemTile } from "@/components/item-tile";
import { Page } from "@/components/page";
import { toneDot } from "@/lib/format";
import {
	type ItemKind,
	useItems,
	useVaults,
	type Vault,
} from "@/lib/vault-data";

const searchSchema = z.object({
	vault: z.string().optional(),
	kind: z.string().optional(),
	q: z.string().optional(),
	id: z.string().optional(),
	new: z.boolean().optional(),
	import: z.boolean().optional(),
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
	const setImporting = (open: boolean) =>
		navigate({ search: (prev) => ({ ...prev, import: open || undefined }) });

	const description = vault
		? vault.personal
			? "Only you can open this vault."
			: `${vault.description ? `${vault.description} ` : ""}Shared with ${vault.members.length} ${vault.members.length === 1 ? "person" : "people"}.`
		: `${count(items.data?.length ?? 0, "item")} across ${count(vaults.data?.length ?? 0, "vault")}.`;

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
					<Button variant="outline" onClick={() => setImporting(true)}>
						<UploadSimpleIcon data-icon="inline-start" />
						Import
					</Button>
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
				<EmptyVault
					onAdd={() => setNew(true)}
					onImport={() => setImporting(true)}
					vault={vault}
				/>
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
			<ImportDialog
				open={Boolean(search.import)}
				onOpenChange={setImporting}
				defaultVaultId={vault?.id}
				onImported={(vaultId) => navigate({ search: { vault: vaultId } })}
			/>
		</Page>
	);
}

function count(n: number, noun: string) {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The kind of things a team keeps here, drifting past on an empty vault. */
const examples: { kind: ItemKind; name: string }[][] = [
	[
		{ kind: "login", name: "GitHub" },
		{ kind: "api-key", name: "Stripe live key" },
		{ kind: "note", name: "Office Wi-Fi" },
		{ kind: "ssh-key", name: "deploy@prod" },
		{ kind: "login", name: "Figma" },
		{ kind: "api-key", name: "OpenAI API key" },
	],
	[
		{ kind: "login", name: "Google Workspace" },
		{ kind: "api-key", name: "Postgres · staging" },
		{ kind: "note", name: "Door codes" },
		{ kind: "login", name: "AWS root" },
		{ kind: "api-key", name: "Cloudflare token" },
		{ kind: "ssh-key", name: "Backup server" },
	],
];

function EmptyVault({
	onAdd,
	onImport,
	vault,
}: {
	onAdd: () => void;
	onImport: () => void;
	vault?: Vault;
}) {
	return (
		<div
			data-slot="empty-vault"
			className="rounded-window bg-surface shadow-card flex flex-col items-center gap-3 px-6 py-14 text-center"
		>
			<div
				aria-hidden
				className="animate-in fade-in fill-mode-both mb-2 flex w-full max-w-md flex-col gap-2 duration-700"
			>
				{examples.map((row, index) => (
					<div key={row[0]?.name} data-slot="marquee">
						<div
							data-slot="marquee-track"
							data-reverse={index === 1 || undefined}
							style={
								{ "--marquee-duration": `${36 + index * 8}s` } as CSSProperties
							}
						>
							{[...row, ...row].map((example, position) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: each row repeats its chips once
									key={position}
									className="bg-surface shadow-pill text-caption text-fg-muted mr-2 inline-flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1"
								>
									<ItemTile
										kind={example.kind}
										size="sm"
										className="bg-surface-sunken shadow-none"
									/>
									{example.name}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
			<div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both flex flex-col items-center gap-1.5 delay-200 duration-500">
				<h2 className="text-h5 text-fg">
					{vault ? `Nothing in ${vault.name} yet` : "Nothing stored yet"}
				</h2>
				<p className="text-body-sm text-fg-muted max-w-md text-balance">
					{!vault
						? "Keep your team's logins, API keys and notes in one place."
						: vault.personal
							? "Logins, keys and notes only you can open."
							: `Everyone with access to ${vault.name} can use what you add here.`}
				</p>
			</div>
			<div className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both mt-2 flex flex-col items-center gap-4 delay-300 duration-500">
				<div className="flex items-center gap-2">
					<Button onClick={onAdd}>
						<PlusIcon data-icon="inline-start" />
						Add your first item
					</Button>
					<Button variant="ghost" onClick={onImport}>
						Import from a CSV
					</Button>
				</div>
				<p className="text-caption text-fg-subtle flex items-center gap-1.5">
					<LockSimpleIcon className="size-3.5" />
					Encrypted on this device before anything is saved
				</p>
			</div>
		</div>
	);
}
