import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@mima/ui/components/dropdown-menu";
import { Switch } from "@mima/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mima/ui/components/tooltip";
import { cn } from "@mima/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	DotsThreeIcon,
	PencilSimpleIcon,
	PlusIcon,
	RobotIcon,
	StarIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { ago, toneDot } from "@/lib/format";
import {
	errorMessage,
	type Item,
	useActions,
	useAgents,
	useMembers,
	useVaults,
} from "@/lib/vault-data";

import { ConfirmDialog } from "./confirm-dialog";
import { CopyButton } from "./copy-button";
import { GrantDialog } from "./grant-dialog";
import { ItemDialog } from "./item-dialog";
import { ItemTile, kindLabel } from "./item-tile";
import { notify } from "./notify";
import { OneTimeCode } from "./one-time-code";
import { SecretValue } from "./secret-value";

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
	const actions = useActions();
	const vaults = useVaults();
	const agents = useAgents();
	const members = useMembers();
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [granting, setGranting] = useState(false);

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

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col">
			<header className="border-line-subtle flex items-start gap-3 border-b p-4">
				<ItemTile kind={item.kind} size="lg" />
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
							<DropdownMenuItem
								variant="destructive"
								onClick={() => setDeleting(true)}
							>
								<TrashIcon />
								Delete item
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</header>

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

			<footer className="rounded-b-window border-line-subtle bg-surface-sunken text-caption text-fg-subtle border-t px-4 py-2.5">
				Updated {ago(item.updatedAt)} by {editor?.name ?? "someone"}
			</footer>

			<ItemDialog open={editing} onOpenChange={setEditing} item={item} />
			<GrantDialog item={item} open={granting} onOpenChange={setGranting} />
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${item.name}?`}
				description="Everyone with access to this vault loses it, and agents can't use it anymore. This can't be undone."
				confirm="Delete item"
				destructive
				onConfirm={async () => {
					await run(actions.deleteItem(item), `Deleted ${item.name}`);
					navigate({
						to: "/items",
						search: (prev) => ({ ...prev, id: undefined }),
					});
				}}
			/>
		</section>
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
