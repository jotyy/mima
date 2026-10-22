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
	ArrowUpRightIcon,
	CaretUpDownIcon,
	CodeIcon,
	KeyIcon,
	LockSimpleIcon,
	MagnifyingGlassIcon,
	PulseIcon,
	QuestionIcon,
	RobotIcon,
	ShieldCheckIcon,
	SquaresFourIcon,
	UsersThreeIcon,
	VaultIcon,
} from "@phosphor-icons/react";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { type ComponentType, type ReactNode, useEffect } from "react";

import {
	approvalRequests,
	currentMemberId,
	findMember,
	vaults,
	workspace,
} from "@/fixtures/vault";
import { initials, toneDot } from "@/lib/format";

import { MimaMark } from "./mima-mark";

export function AppShell() {
	// Notifications sit centered over the content, not over the whole window.
	useEffect(() => {
		document.documentElement.style.setProperty("--toast-shift", "7rem");
		return () => {
			document.documentElement.style.removeProperty("--toast-shift");
		};
	}, []);

	return (
		<div className="bg-frame flex h-svh flex-col">
			<TopBar />
			<div className="flex min-h-0 flex-1">
				<Sidebar />
				<main className="min-w-0 flex-1 overflow-y-auto">
					<Outlet />
				</main>
			</div>
		</div>
	);
}

function TopBar() {
	const pending = approvalRequests.length;
	return (
		<header className="flex h-14 shrink-0 items-center justify-between px-4">
			<div className="flex items-center gap-1">
				<DropdownMenu>
					<DropdownMenuTrigger
						render={<Button variant="ghost" className="text-fg gap-2 px-2" />}
					>
						<MimaMark />
						<span className="font-medium">{workspace.name}</span>
						<CaretUpDownIcon className="text-fg-subtle size-3.5" />
					</DropdownMenuTrigger>
					<DropdownMenuContent className="w-56" align="start">
						<DropdownMenuGroup>
							<DropdownMenuLabel>Workspaces</DropdownMenuLabel>
							<DropdownMenuItem>
								<MimaMark />
								{workspace.name}
								<span className="text-micro text-fg-faint ml-auto">
									{workspace.plan}
								</span>
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
				<Tooltip>
					<TooltipTrigger
						render={<Button variant="ghost" size="icon" aria-label="Search" />}
					>
						<MagnifyingGlassIcon />
					</TooltipTrigger>
					<TooltipContent>
						Search <Kbd>⌘K</Kbd>
					</TooltipContent>
				</Tooltip>
			</div>
			<Link
				to="/agents"
				className="text-body-sm text-fg hover:bg-tint/4 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
			>
				<ShieldCheckIcon className="text-brand size-4" />
				{pending} waiting for approval
			</Link>
		</header>
	);
}

function Sidebar() {
	return (
		<aside className="flex w-56 shrink-0 flex-col px-3 pb-3">
			<nav className="mt-16 flex flex-col">
				<NavGroup>
					<NavLink to="/" icon={SquaresFourIcon} exact>
						Overview
					</NavLink>
					<NavLink to="/items" icon={KeyIcon} exact>
						All items
					</NavLink>
				</NavGroup>
				<NavGroup label="Vaults">
					{vaults.map((vault) => (
						<NavLink
							key={vault.id}
							to="/items"
							search={{ vault: vault.slug }}
							dot={toneDot[vault.tone]}
						>
							{vault.name}
						</NavLink>
					))}
				</NavGroup>
				<NavGroup label="Agents">
					<NavLink
						to="/agents"
						icon={RobotIcon}
						count={approvalRequests.length}
					>
						Agents
					</NavLink>
					<NavLink to="/activity" icon={PulseIcon}>
						Activity
					</NavLink>
				</NavGroup>
				<NavGroup label="Workspace">
					<NavLink to="/vaults" icon={VaultIcon}>
						Vaults
					</NavLink>
					<NavLink to="/members" icon={UsersThreeIcon}>
						Members
					</NavLink>
				</NavGroup>
			</nav>
			<div className="mt-auto flex flex-col gap-0.5">
				<LockBox />
				<SidebarAction icon={QuestionIcon}>Help</SidebarAction>
				<SidebarAction icon={CodeIcon}>Documentation</SidebarAction>
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
	exact,
	children,
}: {
	to: "/" | "/items" | "/agents" | "/activity" | "/vaults" | "/members";
	search?: { vault?: string };
	icon?: ComponentType<{ className?: string }>;
	dot?: string;
	count?: number;
	exact?: boolean;
	children: ReactNode;
}) {
	return (
		<Link
			to={to}
			search={search}
			activeOptions={{ exact, includeSearch: true }}
			className={navItem}
		>
			{Icon && <Icon className="size-4" />}
			{dot && (
				<span className="flex size-4 items-center justify-center">
					<span className={`size-2 rounded-full ${dot}`} />
				</span>
			)}
			<span className="flex-1 truncate">{children}</span>
			{!!count && (
				<span className="bg-brand text-brand-fg text-micro flex size-5 items-center justify-center rounded-full">
					{count}
				</span>
			)}
		</Link>
	);
}

function SidebarAction({
	icon: Icon,
	children,
}: {
	icon: ComponentType<{ className?: string }>;
	children: ReactNode;
}) {
	return (
		<button type="button" className={navItem}>
			<Icon className="size-4" />
			{children}
		</button>
	);
}

function LockBox() {
	const navigate = useNavigate();
	return (
		<div className="rounded-window border-line bg-surface-sunken text-caption mb-2 flex flex-col gap-1 border p-2.5">
			<span className="text-fg-muted">Locks in 14 minutes</span>
			<button
				type="button"
				onClick={() => navigate({ to: "/login" })}
				className="text-link flex w-fit items-center gap-1 hover:underline"
			>
				Lock now
				<ArrowUpRightIcon className="size-3" />
			</button>
		</div>
	);
}

function UserMenu() {
	const navigate = useNavigate();
	const { theme = "system", setTheme } = useTheme();
	const me = findMember(currentMemberId);
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
					<DropdownMenuLabel>{me.email}</DropdownMenuLabel>
				</DropdownMenuGroup>
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
				<DropdownMenuItem onClick={() => navigate({ to: "/login" })}>
					<LockSimpleIcon />
					Lock mima
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
