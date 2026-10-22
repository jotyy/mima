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
	UserPlusIcon,
	WarningIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ComponentType, type ReactNode, useState } from "react";

import { ActivityRow } from "@/components/activity-row";
import { CopyButton } from "@/components/copy-button";
import { ItemTile } from "@/components/item-tile";
import {
	GiveAccessDialog,
	InviteLinkDialog,
} from "@/components/member-dialogs";
import { notify } from "@/components/notify";
import { Page, SectionTitle } from "@/components/page";
import { ago, plural } from "@/lib/format";
import { useKeyring } from "@/lib/keyring";
import { useLookup } from "@/lib/use-lookup";
import {
	type AccessRequest,
	errorMessage,
	type Item,
	type Member,
	useActions,
	useAgents,
	useEvents,
	useItems,
	useMembers,
	useRequests,
	useVaults,
} from "@/lib/vault-data";

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
	const { me } = useKeyring();
	const needs = useNeeds();
	const firstName = me?.name.split(" ")[0];

	return (
		<Page
			title="Overview"
			description={
				needs.rows.length
					? `Hi ${firstName}. ${needs.rows.length} ${needs.rows.length === 1 ? "thing needs" : "things need"} you.`
					: `Hi ${firstName}. Nothing needs you right now.`
			}
		>
			<SearchCard />

			<div className="mt-8">
				<SectionTitle>
					Needs you
					{needs.rows.length > 0 && (
						<Badge variant="brand" className="ml-2">
							{needs.rows.length}
						</Badge>
					)}
				</SectionTitle>
				{needs.rows.length === 0 ? (
					<div className="rounded-window border-line text-caption text-fg-subtle flex items-center justify-center gap-2 border border-dashed py-8">
						<CheckCircleIcon className="text-success size-4" />
						All clear. New teammates, weak passwords and access requests show up
						here.
					</div>
				) : (
					<section
						aria-label="Needs you"
						className="rounded-window bg-surface shadow-card divide-line-subtle flex flex-col divide-y"
					>
						{needs.rows.map((row) => (
							<NeedRow key={row.id} {...row} />
						))}
					</section>
				)}
			</div>

			<div className="mt-8 grid grid-cols-1 items-start gap-3 md:grid-cols-2">
				<RecentItems />
				<RecentActivity />
			</div>
			{needs.dialogs}
		</Page>
	);
}

function SearchCard() {
	const navigate = useNavigate();
	const items = useItems();
	const vaults = useVaults();
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
					<Tabs
						value={kind}
						onValueChange={(value) => setKind(String(value))}
						className="min-w-0 overflow-x-auto"
					>
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
						className="text-caption text-fg-muted hover:text-fg mr-1.5 flex shrink-0 items-center gap-1 max-sm:hidden"
					>
						All items
						<ArrowUpRightIcon className="size-3" />
					</Link>
				</div>
				<div className="flex h-11 items-center gap-2 pr-1.5 pl-3.5">
					<MagnifyingGlassIcon className="text-fg-subtle size-4" />
					<input
						value={query}
						aria-label="Search everything"
						onChange={(event) => setQuery(event.target.value)}
						placeholder={`Search ${plural(items.data?.length ?? 0, "item")} in ${plural(vaults.data?.length ?? 0, "vault")}`}
						className="text-fg text-field min-w-0 flex-1 bg-transparent outline-none"
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

type NeedRowProps = {
	id: string;
	icon: ComponentType<{ className?: string }>;
	tone: string;
	title: ReactNode;
	meta: string;
	actions: ReactNode;
};

function useNeeds() {
	const { me } = useKeyring();
	const requests = useRequests();
	const items = useItems();
	const agents = useAgents();
	const members = useMembers();
	const vaults = useVaults();
	const actions = useActions();
	const navigate = useNavigate();
	const lookup = useLookup();
	const [busy, setBusy] = useState<string | null>(null);
	const [giving, setGiving] = useState<Member | null>(null);
	const [link, setLink] = useState<{ email: string; token: string } | null>(
		null,
	);
	const isAdmin = me?.role !== "member";
	const hasSharedVaults = (vaults.data ?? []).some((v) => !v.personal);

	const run = async (
		id: string,
		work: () => Promise<unknown>,
		message: string,
	) => {
		setBusy(id);
		try {
			await work();
			notify.success(message);
		} catch (err) {
			notify.error("That didn't work", errorMessage(err));
		} finally {
			setBusy(null);
		}
	};

	const approvals = (requests.data ?? []).map(
		(request: AccessRequest): NeedRowProps => {
			const agent = lookup.agents.get(request.agentId);
			const item = lookup.items.get(request.itemId);
			const id = `approval-${request.id}`;
			return {
				id,
				icon: ShieldCheckIcon,
				tone: "text-brand",
				title: (
					<>
						<span className="font-medium">{agent?.name ?? "An agent"}</span>{" "}
						wants <span className="font-medium">{item?.name ?? "an item"}</span>
					</>
				),
				meta: `for ${request.command} · ${ago(request.createdAt)}`,
				actions: (
					<>
						<Button
							variant="ghost"
							size="sm"
							disabled={busy === id}
							onClick={() =>
								run(
									id,
									() => actions.deny(request),
									`Denied ${agent?.name ?? "the agent"}`,
								)
							}
						>
							Deny
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy === id || !item}
							onClick={() =>
								run(
									id,
									() => actions.approve(request, "once"),
									`Allowed ${agent?.name ?? "the agent"} once`,
								)
							}
						>
							Allow once
						</Button>
					</>
				),
			};
		},
	);

	const weak = (items.data ?? [])
		.filter((item: Item) => item.strength === "weak")
		.map(
			(item): NeedRowProps => ({
				id: `weak-${item.id}`,
				icon: WarningIcon,
				tone: "text-warning",
				title: (
					<>
						<span className="font-medium">{item.name}</span> has a weak password
					</>
				),
				meta: `${lookup.vaults.get(item.vaultId)?.name ?? ""} · changed ${ago(item.updatedAt)}`,
				actions: (
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							navigate({
								to: "/items",
								search: { id: item.id, vault: item.vaultId },
							})
						}
					>
						Change
					</Button>
				),
			}),
		);

	const soon = Date.now() + 3 * 86_400_000;
	const expiring = (agents.data ?? [])
		.filter((agent) => {
			const at = agent.expiresAt ? new Date(agent.expiresAt).getTime() : null;
			return (
				agent.enabled &&
				at !== null &&
				at < soon &&
				(agent.ownerId === me?.id || isAdmin)
			);
		})
		.map((agent): NeedRowProps => {
			const id = `expiring-${agent.id}`;
			const left = Math.ceil(
				(new Date(agent.expiresAt as Date).getTime() - Date.now()) / 86_400_000,
			);
			return {
				id,
				icon: ClockIcon,
				tone: "text-fg-muted",
				title: (
					<>
						<span className="font-medium">{agent.name}</span>{" "}
						{left <= 0
							? "lost access"
							: `loses access in ${left} ${left === 1 ? "day" : "days"}`}
					</>
				),
				meta: `${agent.host ?? "not used yet"} · owned by ${agent.ownerName}`,
				actions: (
					<Button
						variant="outline"
						size="sm"
						disabled={busy === id}
						onClick={() =>
							run(
								id,
								() => actions.updateAgent(agent.id, { extendDays: 7 }),
								`Extended ${agent.name} by 7 days`,
							)
						}
					>
						Extend 7 days
					</Button>
				),
			};
		});

	const newcomers =
		isAdmin && hasSharedVaults
			? (members.data?.members ?? [])
					.filter(
						(m) =>
							m.role !== "owner" &&
							m.userId !== me?.id &&
							m.sharedVaultIds.length === 0,
					)
					.map(
						(member): NeedRowProps => ({
							id: `newcomer-${member.userId}`,
							icon: UserPlusIcon,
							tone: "text-brand",
							title: (
								<>
									<span className="font-medium">{member.name}</span> joined and
									can't open any shared vault yet
								</>
							),
							meta: `${member.email} · joined ${ago(member.createdAt)}`,
							actions: (
								<Button
									variant="outline"
									size="sm"
									onClick={() => setGiving(member)}
								>
									Give access
								</Button>
							),
						}),
					)
			: [];

	const invites = isAdmin
		? (members.data?.invites ?? []).map((pending): NeedRowProps => {
				const id = `invite-${pending.id}`;
				return {
					id,
					icon: EnvelopeSimpleIcon,
					tone: "text-fg-muted",
					title: (
						<>
							<span className="font-medium">{pending.email}</span> hasn't joined
							yet
						</>
					),
					meta: `invited ${ago(pending.createdAt)} as ${pending.role}`,
					actions: (
						<Button
							variant="outline"
							size="sm"
							disabled={busy === id}
							onClick={async () => {
								setBusy(id);
								try {
									const { token } = await actions.invite(
										pending.email,
										pending.role,
									);
									setLink({ email: pending.email, token });
								} catch (err) {
									notify.error("Couldn't create a new link", errorMessage(err));
								} finally {
									setBusy(null);
								}
							}}
						>
							New link
						</Button>
					),
				};
			})
		: [];

	return {
		rows: [...approvals, ...newcomers, ...weak, ...expiring, ...invites],
		dialogs: (
			<>
				<GiveAccessDialog
					member={giving}
					onOpenChange={(open) => !open && setGiving(null)}
				/>
				<InviteLinkDialog
					invite={link}
					onOpenChange={(open) => !open && setLink(null)}
				/>
			</>
		),
	};
}

function NeedRow({ icon: Icon, tone, title, meta, actions }: NeedRowProps) {
	return (
		<div className="flex items-center gap-3 px-3.5 py-3">
			<span className="bg-surface shadow-pill flex size-7 shrink-0 items-center justify-center rounded-md">
				<Icon className={cn("size-4", tone)} />
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<p className="text-body-sm text-fg truncate">{title}</p>
				<p className="text-caption text-fg-subtle truncate">{meta}</p>
			</div>
			<div className="flex shrink-0 items-center gap-1.5">{actions}</div>
		</div>
	);
}

function RecentItems() {
	const { me } = useKeyring();
	const items = useItems();
	const events = useEvents();
	const lookup = useLookup();
	const actions = useActions();
	const [tab, setTab] = useState("recent");

	const used = new Map<string, Date>();
	for (const event of events.data ?? []) {
		if (
			event.actorId === me?.id &&
			(event.action === "copied" || event.action === "revealed") &&
			event.itemId &&
			!used.has(event.itemId)
		) {
			used.set(event.itemId, new Date(event.createdAt));
		}
	}
	const recent = [...used.entries()]
		.map(([id, at]) => ({ item: lookup.items.get(id), at }))
		.filter((row): row is { item: Item; at: Date } => Boolean(row.item));
	const list =
		tab === "recent"
			? recent.slice(0, 5)
			: (items.data ?? [])
					.filter((item) => item.favorite)
					.slice(0, 5)
					.map((item) => ({ item, at: undefined }));

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-1.5">
			<div className="pb-1">
				<Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
					<TabsList variant="ghost">
						<TabsTrigger value="recent">Recently used</TabsTrigger>
						<TabsTrigger value="favorites">Favorites</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>
			{list.length === 0 ? (
				<p className="text-caption text-fg-subtle px-2 py-6 text-center">
					{tab === "recent"
						? "Items you copy or reveal show up here."
						: "Star an item to keep it here."}
				</p>
			) : (
				<ul className="flex flex-col gap-0.5">
					{list.map(({ item, at }) => (
						<li
							key={item.id}
							className="group/row hover:bg-tint/3 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors"
						>
							<ItemTile kind={item.kind} />
							<Link
								to="/items"
								search={{ id: item.id, vault: item.vaultId }}
								className="flex min-w-0 flex-1 flex-col"
							>
								<span className="text-body-sm text-fg truncate">
									{item.name}
								</span>
								<span className="text-caption text-fg-subtle truncate">
									{item.username ?? lookup.vaults.get(item.vaultId)?.name}
								</span>
							</Link>
							<div className="flex items-center opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">
								{item.username && (
									<CopyButton
										value={item.username}
										label="username"
										source={item.name}
										secret={false}
										onCopied={() => actions.logUse(item, "copied", "username")}
									/>
								)}
								{item.secret && (
									<CopyButton
										value={item.secret}
										label={item.kind === "login" ? "password" : "value"}
										source={item.name}
										onCopied={() => actions.logUse(item, "copied", "secret")}
									/>
								)}
							</div>
							{at && (
								<span className="text-caption text-fg-subtle w-14 shrink-0 text-right tabular-nums">
									{ago(at)}
								</span>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

function RecentActivity() {
	const events = useEvents();
	const lookup = useLookup();
	const latest = (events.data ?? []).slice(0, 6);

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
			{latest.length === 0 ? (
				<p className="text-caption text-fg-subtle px-2 py-6 text-center">
					Nothing yet.
				</p>
			) : (
				<ol className="flex flex-col">
					{latest.map((event) => (
						<ActivityRow key={event.id} event={event} lookup={lookup} compact />
					))}
				</ol>
			)}
		</section>
	);
}
