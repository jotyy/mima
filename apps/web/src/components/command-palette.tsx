import {
	GearSixIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	PulseIcon,
	RobotIcon,
	SquaresFourIcon,
	TrashIcon,
	UploadSimpleIcon,
	UsersThreeIcon,
	VaultIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@vauly/ui/components/dialog";
import { Kbd } from "@vauly/ui/components/kbd";
import { cn } from "@vauly/ui/lib/utils";
import { type ComponentType, type ReactNode, useMemo, useState } from "react";

import { toneDot } from "@/lib/format";
import { importApps } from "@/lib/import/apps";
import { logoDomain } from "@/lib/logos";
import { itemMatches, useActions, useItems, useVaults } from "@/lib/vault-data";

import { ItemTile } from "./item-tile";
import { copyToClipboard } from "./notify";

type Result = {
	id: string;
	group: "Items" | "Vaults" | "Go to";
	label: string;
	hint?: string;
	icon: ReactNode;
	run: () => void;
	copy?: () => void;
};

const pages: {
	label: string;
	to:
		| "/"
		| "/agents"
		| "/activity"
		| "/vaults"
		| "/members"
		| "/settings"
		| "/deleted";
	icon: ComponentType<{ className?: string }>;
}[] = [
	{ label: "Overview", to: "/", icon: SquaresFourIcon },
	{ label: "Agents", to: "/agents", icon: RobotIcon },
	{ label: "Activity", to: "/activity", icon: PulseIcon },
	{ label: "Vaults", to: "/vaults", icon: VaultIcon },
	{ label: "Members", to: "/members", icon: UsersThreeIcon },
	{ label: "Settings", to: "/settings", icon: GearSixIcon },
	{ label: "Recently deleted", to: "/deleted", icon: TrashIcon },
];

export function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const items = useItems();
	const vaults = useVaults();
	const actions = useActions();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);

	const close = () => {
		onOpenChange(false);
		setQuery("");
		setActive(0);
	};

	const results = useMemo<Result[]>(() => {
		const q = query.trim().toLowerCase();
		const match = (...values: (string | undefined)[]) =>
			!q || values.some((value) => value?.toLowerCase().includes(q));
		const vaultName = new Map((vaults.data ?? []).map((v) => [v.id, v.name]));

		const itemResults = (items.data ?? [])
			.filter((item) => !q || itemMatches(item, q))
			.slice(0, 8)
			.map<Result>((item) => ({
				id: item.id,
				group: "Items",
				label: item.name,
				hint: [item.username, vaultName.get(item.vaultId)]
					.filter(Boolean)
					.join(" · "),
				icon: (
					<ItemTile
						kind={item.kind}
						logo={logoDomain(item)}
						className="size-6"
					/>
				),
				run: () =>
					navigate({
						to: "/items",
						search: { id: item.id, vault: item.vaultId },
					}),
				copy: item.secret
					? () => {
							copyToClipboard(item.secret as string, {
								label: item.kind === "login" ? "password" : "value",
								source: item.name,
							});
							actions.logUse(item, "copied", "secret");
						}
					: undefined,
			}));

		const vaultResults = (vaults.data ?? [])
			.filter((vault) => match(vault.name))
			.slice(0, 4)
			.map<Result>((vault) => ({
				id: vault.id,
				group: "Vaults",
				label: vault.name,
				hint: `${vault.itemCount} items`,
				icon: (
					<span className="flex size-6 items-center justify-center">
						<span className={cn("size-2 rounded-full", toneDot[vault.tone])} />
					</span>
				),
				run: () => navigate({ to: "/items", search: { vault: vault.id } }),
			}));

		const pageResults = [
			...(match("new item", "add")
				? [
						{
							label: "New item",
							to: "/items" as const,
							icon: PlusIcon,
							search: { new: true },
						},
					]
				: []),
			...(match("import items", "csv", ...importApps.map((app) => app.name))
				? [
						{
							label: "Import items",
							to: "/items" as const,
							icon: UploadSimpleIcon,
							search: { import: true },
						},
					]
				: []),
			...pages.filter((page) => match(page.label)),
		].map<Result>((page) => ({
			id: page.label,
			group: "Go to",
			label: page.label,
			icon: (
				<span className="text-fg-muted flex size-6 items-center justify-center">
					<page.icon className="size-4" />
				</span>
			),
			run: () =>
				"search" in page
					? navigate({ to: "/items", search: page.search })
					: navigate({ to: page.to }),
		}));

		return [...itemResults, ...vaultResults, ...pageResults];
	}, [query, items.data, vaults.data, navigate, actions]);

	const current = results[Math.min(active, results.length - 1)];

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => (next ? onOpenChange(true) : close())}
		>
			<DialogContent
				showCloseButton={false}
				className="top-24 translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
			>
				<DialogTitle className="sr-only">Search vauly</DialogTitle>
				<div className="border-line-subtle flex h-12 items-center gap-2.5 border-b px-4">
					<MagnifyingGlassIcon className="text-fg-subtle size-4" />
					<input
						autoFocus
						value={query}
						placeholder="Search items, vaults and pages"
						className="text-fg text-field min-w-0 flex-1 bg-transparent outline-none"
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(0);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActive((i) => Math.min(i + 1, results.length - 1));
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setActive((i) => Math.max(i - 1, 0));
							} else if (event.key === "Enter" && current) {
								event.preventDefault();
								current.run();
								close();
							} else if (
								(event.metaKey || event.ctrlKey) &&
								event.key.toLowerCase() === "c" &&
								event.currentTarget.selectionStart ===
									event.currentTarget.selectionEnd &&
								current?.copy
							) {
								event.preventDefault();
								current.copy();
								close();
							}
						}}
					/>
				</div>
				<div className="max-h-96 overflow-y-auto p-1.5" role="listbox">
					{results.length === 0 && (
						<p className="text-caption text-fg-subtle px-3 py-8 text-center">
							Nothing matches "{query}".
						</p>
					)}
					{results.map((result, index) => (
						<div key={`${result.group}-${result.id}`}>
							{(index === 0 || results[index - 1]?.group !== result.group) && (
								<p className="text-micro text-fg-subtle px-2.5 pt-2 pb-1">
									{result.group}
								</p>
							)}
							<button
								type="button"
								role="option"
								aria-selected={index === active}
								onMouseMove={() => setActive(index)}
								onClick={() => {
									result.run();
									close();
								}}
								className={cn(
									"flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors",
									index === active && "bg-tint/5",
								)}
							>
								{result.icon}
								<span className="text-body-sm text-fg truncate">
									{result.label}
								</span>
								{result.hint && (
									<span className="text-caption text-fg-subtle truncate">
										{result.hint}
									</span>
								)}
							</button>
						</div>
					))}
				</div>
				<div className="border-line-subtle bg-surface-sunken text-caption text-fg-subtle flex items-center gap-4 border-t px-4 py-2">
					<span className="flex items-center gap-1.5">
						<Kbd>↵</Kbd> open
					</span>
					<span className="flex items-center gap-1.5">
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd> move
					</span>
					{current?.copy && (
						<span className="flex items-center gap-1.5">
							<Kbd>⌘C</Kbd> copy password
						</span>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
