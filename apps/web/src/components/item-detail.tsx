import {
	ArrowSquareOutIcon,
	ArrowUpRightIcon,
	CaretRightIcon,
	CopySimpleIcon,
	DotsThreeIcon,
	LinkSimpleIcon,
	PencilSimpleIcon,
	PlusIcon,
	RobotIcon,
	StarIcon,
	TrashIcon,
	UserMinusIcon,
} from "@phosphor-icons/react";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { Badge } from "@vauly/ui/components/badge";
import { Button } from "@vauly/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vauly/ui/components/dropdown-menu";
import { Switch } from "@vauly/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@vauly/ui/components/tooltip";
import { cn } from "@vauly/ui/lib/utils";
import { type ReactNode, useState } from "react";

import { ago, plural, timeLeft, toneDot } from "@/lib/format";
import { logoDomain } from "@/lib/logos";
import { useLookup } from "@/lib/use-lookup";
import {
	errorMessage,
	type Item,
	useActions,
	useAgents,
	useExposed,
	useItemEvents,
	useLinks,
	useMembers,
	useVaults,
} from "@/lib/vault-data";

import { ActivityRow } from "./activity-row";
import { CopyButton } from "./copy-button";
import { GrantDialog } from "./grant-dialog";
import { ItemDialog } from "./item-dialog";
import { ItemTile, kindLabel } from "./item-tile";
import { notify } from "./notify";
import { OneTimeCode } from "./one-time-code";
import { SecretValue } from "./secret-value";
import { ShareLinkDialog } from "./share-link-dialog";

const secretLabel: Record<Item["kind"], string> = {
	login: "Password",
	"api-key": "Value",
	note: "Value",
	"ssh-key": "Private key",
};

const strengthBadge = {
	strong: { label: "Strong", variant: "success" },
	fair: { label: "Fair", variant: "warning" },
	weak: { label: "Weak", variant: "destructive" },
} as const;

export function ItemDetail({ item }: { item: Item }) {
	const navigate = useNavigate();
	const router = useRouter();
	const actions = useActions();
	const vaults = useVaults();
	const agents = useAgents();
	const members = useMembers();
	const lookup = useLookup();
	const links = useLinks(item.id);
	const history = useItemEvents(item.id);
	const exposure = useExposed().exposed.get(item.id);
	const [editing, setEditing] = useState(false);
	const [granting, setGranting] = useState(false);
	const [sharing, setSharing] = useState(false);

	const vault = vaults.data?.find((v) => v.id === item.vaultId);
	const editor = members.data?.members.find((m) => m.userId === item.updatedBy);
	const withAccess = (agents.data ?? []).filter((agent) =>
		agent.grants.some((grant) => grant.itemId === item.id),
	);
	const label = secretLabel[item.kind];
	const log = (action: "revealed" | "copied", field: string) => () =>
		actions.logUse(item, action, field);

	const run = async (work: Promise<unknown>, message: string) => {
		try {
			await work;
			notify.success(message);
		} catch (err) {
			notify.error("That didn't work", errorMessage(err));
		}
	};

	// No confirmation: the item waits in Recently deleted, and the toast can undo it.
	const remove = async () => {
		try {
			await actions.deleteItem(item);
		} catch (err) {
			return notify.error("Couldn't delete it", errorMessage(err));
		}
		// Only if the person is still looking at the list; they may have moved on.
		if (router.state.location.pathname === "/items") {
			navigate({
				to: "/items",
				search: (prev) => ({ ...prev, id: undefined }),
			});
		}
		notify.undo(`Moved ${item.name} to Recently deleted`, () =>
			run(actions.restoreItem(item), `Restored ${item.name}`),
		);
	};

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col">
			<header className="border-line-subtle flex items-start gap-3 border-b p-4">
				<ItemTile kind={item.kind} size="lg" logo={logoDomain(item)} />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<h2 className="text-fg text-h5 truncate">{item.name}</h2>
					<div className="flex flex-wrap items-center gap-1.5">
						{vault && (
							<Badge>
								<span
									className={`size-1.5 rounded-full ${toneDot[vault.tone]}`}
								/>
								{vault.name}
							</Badge>
						)}
						<Badge variant="secondary">{kindLabel[item.kind]}</Badge>
						{item.strength && (
							<Badge variant={strengthBadge[item.strength].variant}>
								{strengthBadge[item.strength].label}
							</Badge>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={
										item.favorite ? "Remove from favorites" : "Add to favorites"
									}
									aria-pressed={item.favorite}
									onClick={() => actions.toggleFavorite(item)}
								/>
							}
						>
							<StarIcon
								weight={item.favorite ? "fill" : "regular"}
								className={cn(item.favorite && "text-chart-3")}
							/>
						</TooltipTrigger>
						<TooltipContent>
							{item.favorite ? "Favorite" : "Add to favorites"}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Share a link"
									onClick={() => setSharing(true)}
								/>
							}
						>
							<LinkSimpleIcon />
						</TooltipTrigger>
						<TooltipContent>Share a link</TooltipContent>
					</Tooltip>
					<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
						<PencilSimpleIcon data-icon="inline-start" />
						Edit
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="More actions"
								/>
							}
						>
							<DotsThreeIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-52">
							{item.secret && (
								<>
									<DropdownMenuItem onClick={() => setGranting(true)}>
										<RobotIcon />
										Use with an agent…
									</DropdownMenuItem>
									<DropdownMenuSeparator />
								</>
							)}
							<DropdownMenuGroup>
								<DropdownMenuLabel>Move to</DropdownMenuLabel>
								{(vaults.data ?? [])
									.filter((v) => v.id !== item.vaultId)
									.map((target) => (
										<DropdownMenuItem
											key={target.id}
											onClick={() =>
												run(
													actions.updateItem(item, fieldsOf(item), target),
													`Moved to ${target.name}`,
												)
											}
										>
											<span
												className={`size-2 rounded-full ${toneDot[target.tone]}`}
											/>
											{target.name}
										</DropdownMenuItem>
									))}
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={remove}>
								<TrashIcon />
								Delete item
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

			{item.reusedWith?.length ? (
				<div className="border-warning-line bg-warning-soft text-caption text-warning mx-4 mt-3 flex items-center gap-2 rounded-lg border px-3 py-2">
					<CopySimpleIcon className="size-4 shrink-0" />
					<p className="min-w-0 flex-1">
						Same password as{" "}
						{item.reusedWith.map((id, index) => {
							const other = lookup.items.get(id);
							return (
								<span key={id}>
									{index > 0 && ", "}
									{other ? (
										<Link
											to="/items"
											search={{ id, health: "reused" }}
											className="font-medium underline-offset-2 hover:underline"
										>
											{other.name}
										</Link>
									) : (
										"another item"
									)}
								</span>
							);
						})}
						.{" "}
						{item.reusedWith.length === 1
							? "If one leaks, the other is open too."
							: "If one leaks, the others are open too."}
					</p>
					<Button variant="outline" size="xs" onClick={() => setEditing(true)}>
						Change
					</Button>
				</div>
			) : null}

			{exposure ? (
				<div className="border-warning-line bg-warning-soft text-caption text-warning mx-4 mt-3 flex items-center gap-2 rounded-lg border px-3 py-2">
					<UserMinusIcon className="size-4 shrink-0" />
					<p className="min-w-0 flex-1">
						<span className="font-medium">
							{exposure.people.map((person) => person.name).join(", ")}
						</span>{" "}
						could see this before losing access{" "}
						{ago(exposure.people[0]?.at ?? new Date())}. Change it so any copy
						they kept stops working.
					</p>
					<Button variant="outline" size="xs" onClick={() => setEditing(true)}>
						Change
					</Button>
				</div>
			) : null}

			<dl className="divide-line-subtle flex flex-col divide-y px-4">
				{item.username && (
					<Field label="Username">
						<span className="text-body-sm text-fg min-w-0 flex-1 truncate">
							{item.username}
						</span>
						<CopyButton
							value={item.username}
							label="username"
							source={item.name}
							secret={false}
							onCopied={log("copied", "username")}
						/>
					</Field>
				)}
				{item.secret && (
					<Field label={label}>
						<SecretValue
							value={item.secret}
							label={label.toLowerCase()}
							source={item.name}
							onReveal={log("revealed", "secret")}
							onCopied={log("copied", "secret")}
						/>
					</Field>
				)}
				{item.history?.length ? (
					<EarlierSecrets
						item={item}
						label={label.toLowerCase()}
						onReveal={log("revealed", `earlier ${label.toLowerCase()}`)}
						onCopied={log("copied", `earlier ${label.toLowerCase()}`)}
					/>
				) : null}
				{item.totp && (
					<Field label="One-time code">
						<OneTimeCode
							secret={item.totp}
							source={item.name}
							onCopied={log("copied", "one-time code")}
						/>
					</Field>
				)}
				{item.url && (
					<Field label="Website">
						<a
							href={item.url}
							target="_blank"
							rel="noreferrer"
							className="text-body-sm text-link flex min-w-0 items-center gap-1 hover:underline"
						>
							<span className="truncate">{hostOf(item.url)}</span>
							<ArrowSquareOutIcon className="size-3.5 shrink-0" />
						</a>
					</Field>
				)}
				{item.notes && (
					<Field label="Notes">
						<p className="text-body-sm text-fg py-1 leading-relaxed whitespace-pre-wrap">
							{item.notes}
						</p>
					</Field>
				)}
				{(item.tags?.length ?? 0) > 0 && (
					<Field label="Tags">
						<div className="flex flex-wrap gap-1">
							{item.tags?.map((tag) => (
								<Badge key={tag} variant="secondary">
									{tag}
								</Badge>
							))}
						</div>
					</Field>
				)}
			</dl>

			{links.data?.length ? (
				<section
					aria-label="Shared links"
					className="border-line-subtle mt-2 flex flex-col gap-2 border-t p-4"
				>
					<div className="flex items-center justify-between">
						<h3 className="text-body-sm text-fg">Shared links</h3>
						<Button variant="ghost" size="xs" onClick={() => setSharing(true)}>
							<PlusIcon data-icon="inline-start" />
							New link
						</Button>
					</div>
					<ul className="flex flex-col gap-1">
						{links.data.map((link) => (
							<li
								key={link.id}
								className="hover:bg-tint/3 flex items-center gap-2.5 rounded-lg px-2 py-1.5"
							>
								<span className="bg-surface shadow-pill text-fg-muted flex size-7 shrink-0 items-center justify-center rounded-md">
									<LinkSimpleIcon className="size-4" />
								</span>
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="text-body-sm text-fg">
										Expires {timeLeft(link.expiresAt)}
									</span>
									<span className="text-caption text-fg-subtle truncate">
										{link.maxViews === 1
											? "One view"
											: link.views
												? `Opened ${plural(link.views, "time")}`
												: "Not opened yet"}
										{" · "}
										by {link.createdByName ?? "someone who left"}
									</span>
								</div>
								<Button
									variant="ghost"
									size="xs"
									onClick={() =>
										run(actions.revokeLink(link.id), "Turned the link off")
									}
								>
									Turn off
								</Button>
							</li>
						))}
					</ul>
				</section>
			) : null}

			{withAccess.length > 0 && (
				<div className="border-line-subtle mt-2 flex flex-col gap-2 border-t p-4">
					<div className="flex items-center justify-between">
						<h3 className="text-body-sm text-fg">Agents that can use it</h3>
						<Button variant="ghost" size="xs" onClick={() => setGranting(true)}>
							<PlusIcon data-icon="inline-start" />
							Add
						</Button>
					</div>
					<ul className="flex flex-col gap-1">
						{withAccess.map((agent) => {
							const grant = agent.grants.find((g) => g.itemId === item.id);
							return (
								<li
									key={agent.id}
									className="hover:bg-tint/3 flex items-center gap-2.5 rounded-lg px-2 py-1.5"
								>
									<ItemTile kind="agent" />
									<div className="flex min-w-0 flex-1 flex-col">
										<span className="text-body-sm text-fg">{agent.name}</span>
										<span className="text-caption text-fg-subtle truncate">
											{grant?.once
												? "for one run"
												: grant?.expiresAt
													? `until ${new Date(grant.expiresAt).toLocaleString()}`
													: "until you revoke it"}
										</span>
									</div>
									<Switch
										defaultChecked
										aria-label={`Allow ${agent.name}`}
										onCheckedChange={(checked) => {
											if (!checked) {
												run(
													actions.revoke(agent.id, item.id),
													`${agent.name} can no longer use ${item.name}`,
												);
											}
										}}
									/>
								</li>
							);
						})}
					</ul>
				</div>
			)}

			{history.data?.length ? (
				<section
					aria-label="Recent activity"
					className="border-line-subtle mt-2 flex flex-col gap-1 border-t px-2 pt-3 pb-2"
				>
					<div className="flex items-center justify-between px-2">
						<h3 className="text-body-sm text-fg">Recent activity</h3>
						<Link
							to="/activity"
							search={{ item: item.id }}
							className="text-caption text-fg-muted hover:text-fg flex items-center gap-1"
						>
							All activity
							<ArrowUpRightIcon className="size-3" />
						</Link>
					</div>
					<ol className="flex flex-col">
						{history.data.slice(0, 5).map((event) => (
							<ActivityRow
								key={event.id}
								event={event}
								lookup={lookup}
								compact
								inItem
							/>
						))}
					</ol>
				</section>
			) : null}

			<footer className="rounded-b-window border-line-subtle bg-surface-sunken text-caption text-fg-subtle border-t px-4 py-2.5">
				Updated {ago(item.updatedAt)} by {editor?.name ?? "someone"}
			</footer>

			<ItemDialog open={editing} onOpenChange={setEditing} item={item} />
			<GrantDialog item={item} open={granting} onOpenChange={setGranting} />
			<ShareLinkDialog item={item} open={sharing} onOpenChange={setSharing} />
		</section>
	);
}

/** Values the item had before, newest first, folded away until someone asks. */
function EarlierSecrets({
	item,
	label,
	onReveal,
	onCopied,
}: {
	item: Item;
	label: string;
	onReveal: () => void;
	onCopied: () => void;
}) {
	const [open, setOpen] = useState(false);
	const history = item.history ?? [];
	return (
		<div className="flex gap-4 py-2.5">
			<dt className="text-caption text-fg-subtle w-28 shrink-0">Earlier</dt>
			<dd className="flex min-w-0 flex-1 flex-col gap-2">
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen((value) => !value)}
					className="text-caption text-fg-muted hover:text-fg flex w-fit items-center gap-1 transition-colors"
				>
					<CaretRightIcon
						className={cn("size-3 transition-transform", open && "rotate-90")}
					/>
					{history.length} earlier {history.length === 1 ? label : `${label}s`}
				</button>
				{open && (
					<ol className="flex flex-col gap-2">
						{history.map((entry) => (
							<li key={entry.until} className="flex flex-col">
								<SecretValue
									value={entry.secret}
									label={`earlier ${label}`}
									source={item.name}
									onReveal={onReveal}
									onCopied={onCopied}
								/>
								<span className="text-caption text-fg-subtle">
									Used until {new Date(entry.until).toLocaleDateString()}
									{entry.by && ` · changed by ${entry.by}`}
								</span>
							</li>
						))}
					</ol>
				)}
			</dd>
		</div>
	);
}

function fieldsOf(item: Item) {
	const { kind, name, username, secret, url, totp, notes, tags } = item;
	return { kind, name, username, secret, url, totp, notes, tags };
}

function hostOf(url: string) {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-h-11 items-center gap-4 py-2">
			<dt className="text-caption text-fg-subtle w-28 shrink-0">{label}</dt>
			<dd className="flex min-w-0 flex-1 items-center gap-1">{children}</dd>
		</div>
	);
}
