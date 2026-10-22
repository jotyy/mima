import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { cn } from "@mima/ui/lib/utils";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	CheckCircleIcon,
	ClockIcon,
	EnvelopeSimpleIcon,
	MagnifyingGlassIcon,
	ShieldCheckIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { ActivityRow } from "@/components/activity-row";
import { CopyButton } from "@/components/copy-button";
import { ItemTile } from "@/components/item-tile";
import { Page, SectionTitle } from "@/components/page";
import {
	activity,
	agents,
	approvalRequests,
	currentMemberId,
	findAgent,
	findItem,
	findMember,
	findVault,
	items,
	members,
	vaults,
} from "@/fixtures/vault";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_app/")({
	component: Overview,
});

const kinds = [
	{ value: "all", label: "Everything" },
	{ value: "login", label: "Logins" },
	{ value: "api-key", label: "API keys" },
	{ value: "note", label: "Notes" },
	{ value: "ssh-key", label: "SSH keys" },
];

function Overview() {
	const me = findMember(currentMemberId);
	const [needs, setNeeds] = useState(buildNeeds);
	const done = (id: string, message: string) => {
		setNeeds((current) => current.filter((need) => need.id !== id));
		toast.success(message);
	};

	const firstName = me?.name.split(" ")[0];
	return (
		<Page
			title="Overview"
			description={
				needs.length
					? `Hi ${firstName}. ${needs.length} things need you.`
					: `Hi ${firstName}. Nothing needs you right now.`
			}
		>
			<SearchCard />

			<div className="mt-8">
				<SectionTitle>
					Needs you
					{needs.length > 0 && (
						<Badge variant="brand" className="ml-2">
							{needs.length}
						</Badge>
					)}
				</SectionTitle>
				{needs.length === 0 ? (
					<div className="rounded-window border-line text-caption text-fg-subtle flex items-center justify-center gap-2 border border-dashed py-8">
						<CheckCircleIcon className="text-success size-4" />
						All clear. Approvals and weak passwords show up here.
					</div>
				) : (
					<section className="rounded-window bg-surface shadow-card divide-line-subtle flex flex-col divide-y">
						{needs.map((need) => (
							<NeedRow key={need.id} need={need} onDone={done} />
						))}
					</section>
				)}
			</div>

			<div className="mt-8 grid grid-cols-2 gap-3">
				<RecentItems />
				<RecentActivity />
			</div>
		</Page>
	);
}

function SearchCard() {
	const navigate = useNavigate();
	const [kind, setKind] = useState("all");
	const [query, setQuery] = useState("");

	return (
		<div className="rounded-window border-line-subtle bg-surface-sunken border">
			<form
				className="rounded-window bg-surface shadow-card"
				onSubmit={(event) => {
					event.preventDefault();
					navigate({
						to: "/items",
						search: {
							q: query || undefined,
							kind: kind === "all" ? undefined : kind,
						},
					});
				}}
			>
				<div className="flex items-center justify-between p-1.5">
					<Tabs value={kind} onValueChange={(value) => setKind(String(value))}>
						<TabsList>
							{kinds.map((k) => (
								<TabsTrigger key={k.value} value={k.value}>
									{k.label}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					<Link
						to="/items"
						className="text-caption text-fg-muted hover:text-fg mr-1.5 flex items-center gap-1"
					>
						All items
						<ArrowUpRightIcon className="size-3" />
					</Link>
				</div>
				<div className="flex h-11 items-center gap-2 pr-1.5 pl-3.5">
					<MagnifyingGlassIcon className="text-fg-subtle size-4" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={`Search ${items.length} items in ${vaults.length} vaults`}
						className="text-fg text-input min-w-0 flex-1 bg-transparent outline-none"
					/>
					<Button type="submit" variant="brand" size="icon" aria-label="Search">
						<ArrowRightIcon />
					</Button>
				</div>
			</form>
			<p className="text-caption text-fg-muted py-2 text-center">
				Press ⌘K to search from anywhere
			</p>
		</div>
	);
}

type Need = {
	id: string;
	icon: ComponentType<{ className?: string }>;
	tone: string;
	title: ReactNode;
	meta: string;
	actions: (onDone: (id: string, message: string) => void) => ReactNode;
};

function buildNeeds(): Need[] {
	const approvals = approvalRequests.flatMap((request): Need[] => {
		const agent = findAgent(request.agentId);
		const item = findItem(request.itemId);
		if (!agent || !item) return [];
		const id = `approval-${request.id}`;
		return [
			{
				id,
				icon: ShieldCheckIcon,
				tone: "text-brand",
				title: (
					<>
						<span className="font-medium">{agent.name}</span> wants{" "}
						<span className="font-medium">{item.name}</span>
					</>
				),
				meta: `for ${request.command} · ${timeAgo(request.requestedMin)}`,
				actions: (onDone) => (
					<>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onDone(id, `Denied ${agent.name}`)}
						>
							Deny
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => onDone(id, `Allowed ${agent.name} once`)}
						>
							Allow once
						</Button>
					</>
				),
			},
		];
	});

	const weak = items
		.filter((item) => item.strength === "weak")
		.map(
			(item): Need => ({
				id: `weak-${item.id}`,
				icon: WarningIcon,
				tone: "text-warning",
				title: (
					<>
						<span className="font-medium">{item.name}</span> has a weak password
					</>
				),
				meta: `${findVault(item.vaultId)?.name} · changed ${timeAgo(item.updatedMin)}`,
				actions: () => (
					<Button
						variant="outline"
						size="sm"
						render={<Link to="/items" search={{ id: item.id }} />}
					>
						Change
					</Button>
				),
			}),
		);

	const expiring = agents
		.filter(
			(agent) =>
				agent.enabled &&
				agent.expiresInDays !== null &&
				agent.expiresInDays <= 3,
		)
		.map((agent): Need => {
			const id = `expiring-${agent.id}`;
			return {
				id,
				icon: ClockIcon,
				tone: "text-fg-muted",
				title: (
					<>
						<span className="font-medium">{agent.name}</span> loses access in{" "}
						{agent.expiresInDays} days
					</>
				),
				meta: `${agent.host} · owned by ${findMember(agent.ownerId)?.name}`,
				actions: (onDone) => (
					<Button
						variant="outline"
						size="sm"
						onClick={() => onDone(id, `Extended ${agent.name} by 7 days`)}
					>
						Extend 7 days
					</Button>
				),
			};
		});

	const invites = members
		.filter((member) => member.invited)
		.map((member): Need => {
			const id = `invite-${member.id}`;
			return {
				id,
				icon: EnvelopeSimpleIcon,
				tone: "text-fg-muted",
				title: (
					<>
						<span className="font-medium">{member.name}</span> hasn't joined yet
					</>
				),
				meta: `invite sent ${timeAgo(member.invitedMin ?? 0)} to ${member.email}`,
				actions: (onDone) => (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							onDone(id, `Sent the invite to ${member.email} again`)
						}
					>
						Resend
					</Button>
				),
			};
		});

	return [...approvals, ...weak, ...expiring, ...invites];
}

function NeedRow({
	need,
	onDone,
}: {
	need: Need;
	onDone: (id: string, message: string) => void;
}) {
	const Icon = need.icon;
	return (
		<div className="flex items-center gap-3 px-3.5 py-3">
			<span className="bg-surface shadow-pill flex size-7 shrink-0 items-center justify-center rounded-md">
				<Icon className={cn("size-4", need.tone)} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="text-body-sm text-fg truncate">{need.title}</p>
				<p className="text-caption text-fg-subtle truncate">{need.meta}</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{need.actions(onDone)}
			</div>
		</div>
	);
}

function RecentItems() {
	const [tab, setTab] = useState("recent");
	const list = items
		.filter((item) =>
			tab === "recent" ? item.usedMin !== undefined : item.favorite,
		)
		.sort((a, b) => (a.usedMin ?? 0) - (b.usedMin ?? 0))
		.slice(0, 5);

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-1.5">
			<div className="flex items-center justify-between pb-1">
				<Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
					<TabsList variant="ghost">
						<TabsTrigger value="recent">Recently used</TabsTrigger>
						<TabsTrigger value="favorites">Favorites</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>
			<ul className="flex flex-col gap-0.5">
				{list.map((item) => (
					<li
						key={item.id}
						className="group/row hover:bg-tint/3 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
					>
						<ItemTile kind={item.kind} />
						<Link
							to="/items"
							search={{ id: item.id }}
							className="flex min-w-0 flex-1 flex-col"
						>
							<span className="text-body-sm text-fg truncate">{item.name}</span>
							<span className="text-caption text-fg-subtle truncate">
								{item.username ?? findVault(item.vaultId)?.name}
							</span>
						</Link>
						<div className="flex items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
							{item.username && (
								<CopyButton value={item.username} label="username" />
							)}
							{item.secret && (
								<CopyButton
									value={item.secret}
									label={item.kind === "login" ? "password" : "value"}
								/>
							)}
						</div>
						<span className="text-caption text-fg-subtle w-14 shrink-0 text-right tabular-nums">
							{timeAgo(item.usedMin ?? 0)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function RecentActivity() {
	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-1.5">
			<div className="flex h-8 items-center justify-between pr-1.5 pb-1 pl-2">
				<span className="text-body-sm text-fg">Recent activity</span>
				<Link
					to="/activity"
					className="text-caption text-fg-muted hover:text-fg flex items-center gap-1"
				>
					All activity
					<ArrowUpRightIcon className="size-3" />
				</Link>
			</div>
			<ol className="flex flex-col">
				{activity.slice(0, 5).map((event) => (
					<ActivityRow key={event.id} event={event} compact />
				))}
			</ol>
		</section>
	);
}
