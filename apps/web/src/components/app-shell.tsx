import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@mima/ui/components/dropdown-menu";
import { Kbd } from "@mima/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import {
	CaretUpDownIcon,
	GearSixIcon,
	KeyIcon,
	LockSimpleIcon,
	MagnifyingGlassIcon,
	PulseIcon,
	RobotIcon,
	ShieldCheckIcon,
	SignOutIcon,
	SquaresFourIcon,
	TrashIcon,
	UsersThreeIcon,
	VaultIcon,
} from "@phosphor-icons/react";
import { Link, Outlet } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import {
	type ComponentType,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

import { initials, toneDot } from "@/lib/format";
import { useKeyring } from "@/lib/keyring";
import {
	useDeletedItems,
	useRequests,
	useVaults,
	useWorkspace,
} from "@/lib/vault-data";

import { CommandPalette } from "./command-palette";
import { MimaMark } from "./mima-mark";

export function AppShell() {
	const [searching, setSearching] = useState(false);
	const main = useRef<HTMLElement>(null);

	// Notifications sit centered over the content column (minus its scrollbar), not over
	// the whole window: measure the column and shift the toast layer to match.
	useEffect(() => {
		const element = main.current;
		if (!element) return;
		const root = document.documentElement;
		const update = () => {
			const box = element.getBoundingClientRect();
			root.style.setProperty(
				"--toast-center",
				`${box.left + element.clientWidth / 2}px`,
			);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		window.addEventListener("resize", update);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", update);
			root.style.removeProperty("--toast-center");
		};
	}, []);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setSearching((open) => !open);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return (
		<div className="bg-frame flex h-svh flex-col">
			<TopBar onSearch={() => setSearching(true)} />
			<div className="flex min-h-0 flex-1">
				<Sidebar />
				<main ref={main} className="min-w-0 flex-1 overflow-y-auto">
					<Outlet />
				</main>
			</div>
			<CommandPalette open={searching} onOpenChange={setSearching} />
		</div>
	);
}

function TopBar({ onSearch }: { onSearch: () => void }) {
	const workspace = useWorkspace();
	const requests = useRequests();
	const pending = requests.data?.length ?? 0;

	return (
		<header className="flex h-14 shrink-0 items-center justify-between px-4">
			<div className="flex items-center gap-1">
				<div className="text-body-sm text-fg flex items-center gap-2 px-2 font-medium">
					<MimaMark />
					{workspace.data?.workspaceName ?? "mima"}
				</div>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon"
								aria-label="Search"
								onClick={onSearch}
							/>
						}
					>
						<MagnifyingGlassIcon />
					</TooltipTrigger>
					<TooltipContent>
						Search <Kbd>⌘K</Kbd>
					</TooltipContent>
				</Tooltip>
			</div>
			{pending > 0 && (
				<Link
					to="/agents"
					className="text-body-sm text-fg hover:bg-tint/4 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
				>
					<ShieldCheckIcon className="text-brand size-4" />
					{pending} waiting for approval
				</Link>
			)}
		</header>
	);
}

function Sidebar() {
	const vaults = useVaults();
	const requests = useRequests();
	const deleted = useDeletedItems();
	const sorted = [...(vaults.data ?? [])].sort(
		(a, b) =>
			Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name),
	);

	return (
		<aside className="flex w-56 shrink-0 flex-col px-3 pb-3">
			<nav className="mt-16 flex min-h-0 flex-col overflow-y-auto">
				<NavGroup>
					<NavLink to="/" icon={SquaresFourIcon} exact>
						Overview
					</NavLink>
					<NavLink to="/items" icon={KeyIcon} exact>
						All items
					</NavLink>
					{!!deleted.data?.length && (
						<NavLink
							to="/deleted"
							icon={TrashIcon}
							count={deleted.data.length}
							muted
						>
							Recently deleted
						</NavLink>
					)}
				</NavGroup>
				<NavGroup label="Vaults">
					{sorted.map((vault) => (
						<NavLink
							key={vault.id}
							to="/items"
							search={{ vault: vault.id }}
							dot={toneDot[vault.tone]}
						>
							{vault.name}
						</NavLink>
					))}
				</NavGroup>
				<NavGroup label="Workspace">
					<NavLink to="/vaults" icon={VaultIcon}>
						Vaults
					</NavLink>
					<NavLink to="/members" icon={UsersThreeIcon}>
						Members
					</NavLink>
					<NavLink to="/activity" icon={PulseIcon}>
						Activity
					</NavLink>
					<NavLink to="/agents" icon={RobotIcon} count={requests.data?.length}>
						Agents
					</NavLink>
				</NavGroup>
			</nav>
			<div className="mt-auto flex flex-col gap-0.5 pt-4">
				<LockBox />
				<UserMenu />
			</div>
		</aside>
	);
}

function NavGroup({
	label,
	children,
}: {
	label?: string;
	children: ReactNode;
}) {
	return (
		<div className="mb-4 flex flex-col gap-0.5">
			{label && <Badge className="mb-1.5 ml-1">{label}</Badge>}
			{children}
		</div>
	);
}

const navItem =
	"group/link relative flex h-8 items-center gap-2.5 rounded-lg pr-2 pl-3 text-body-sm text-fg-muted transition-colors duration-150 hover:bg-tint/4 hover:text-fg data-[status=active]:bg-tint/7 data-[status=active]:font-medium data-[status=active]:text-fg-emphasis";

function NavLink({
	to,
	search,
	icon: Icon,
	dot,
	count,
	muted,
	exact,
	children,
}: {
	to:
		| "/"
		| "/items"
		| "/agents"
		| "/activity"
		| "/vaults"
		| "/members"
		| "/settings"
		| "/deleted";
	search?: { vault?: string };
	icon?: ComponentType<{ className?: string }>;
	dot?: string;
	count?: number;
	/** Shows the count as plain text, for numbers that need no attention. */
	muted?: boolean;
	exact?: boolean;
	children: ReactNode;
}) {
	return (
		<Link
			to={to}
			search={search}
			activeOptions={{ exact, includeSearch: Boolean(search) }}
			className={navItem}
		>
			{Icon && <Icon className="size-4" />}
			{dot && (
				<span className="flex size-4 items-center justify-center">
					<span className={`size-2 rounded-full ${dot}`} />
				</span>
			)}
			<span className="flex-1 truncate">{children}</span>
			{!!count &&
				(muted ? (
					<span className="text-caption text-fg-subtle tabular-nums">
						{count}
					</span>
				) : (
					<span className="bg-brand text-brand-fg text-micro flex size-5 items-center justify-center rounded-full">
						{count}
					</span>
				))}
		</Link>
	);
}

function LockBox() {
	const { locksAt, lock } = useKeyring();
	// Re-render every 15 seconds; a new lock time re-renders straight away.
	const [, tick] = useState(0);
	useEffect(() => {
		const timer = setInterval(() => tick((n) => n + 1), 15_000);
		return () => clearInterval(timer);
	}, []);
	const minutes = locksAt
		? Math.max(1, Math.ceil((locksAt - Date.now()) / 60_000))
		: 0;

	return (
		<div className="rounded-window border-line bg-surface-sunken text-caption mb-2 flex flex-col gap-1 border p-2.5">
			<span className="text-fg-muted">
				Locks in {minutes} {minutes === 1 ? "minute" : "minutes"} of quiet
			</span>
			<button
				type="button"
				onClick={lock}
				className="text-link flex w-fit items-center gap-1 hover:underline"
			>
				<LockSimpleIcon className="size-3" />
				Lock now
			</button>
		</div>
	);
}

function UserMenu() {
	const { me, lock, signOut } = useKeyring();
	const { theme = "system", setTheme } = useTheme();
	if (!me) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<button
						type="button"
						className="text-body-sm text-fg hover:bg-tint/4 mt-1 flex h-9 w-full items-center gap-2.5 rounded-lg px-3 transition-colors"
					/>
				}
			>
				<Avatar size="sm">
					<AvatarFallback>{initials(me.name)}</AvatarFallback>
				</Avatar>
				<span className="flex-1 truncate text-left">{me.name}</span>
				<CaretUpDownIcon className="text-fg-subtle size-3.5" />
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-56" side="top" align="start">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						{me.email} · {me.role}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem render={<Link to="/settings" />}>
					<GearSixIcon />
					Settings
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					<DropdownMenuLabel>Theme</DropdownMenuLabel>
					<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
						<DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={lock}>
					<LockSimpleIcon />
					Lock
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => signOut()}>
					<SignOutIcon />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
