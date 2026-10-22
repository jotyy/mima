import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@mima/ui/components/dropdown-menu";
import { Switch } from "@mima/ui/components/switch";
import {
	ArrowSquareOutIcon,
	ArrowsLeftRightIcon,
	DotsThreeIcon,
	PencilSimpleIcon,
	PlusIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import {
	agents,
	findMember,
	findVault,
	type Item,
	itemReference,
} from "@/fixtures/vault";
import { timeAgo, toneDot } from "@/lib/format";

import { CopyButton } from "./copy-button";
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

const strength = {
	strong: { label: "Strong", variant: "success" },
	fair: { label: "Fair", variant: "warning" },
	weak: { label: "Weak", variant: "destructive" },
} as const;

export function ItemDetail({ item }: { item: Item }) {
	const vault = findVault(item.vaultId);
	const editor = findMember(item.updatedBy);
	const reference = itemReference(item);
	const withAccess = agents.filter((agent) => agent.itemIds.includes(item.id));

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col">
			<header className="border-line-subtle flex items-start gap-3 border-b p-4">
				<ItemTile kind={item.kind} size="lg" />
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<h2 className="text-fg text-h5 truncate">{item.name}</h2>
					<div className="flex items-center gap-1.5">
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
							<Badge variant={strength[item.strength].variant}>
								{strength[item.strength].label}
							</Badge>
						)}
					</div>
				</div>
				<div className="flex items-center gap-1">
					<Button variant="outline" size="sm">
						<PencilSimpleIcon data-icon="inline-start" />
						Edit
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button variant="ghost" size="icon-sm" aria-label="More" />
							}
						>
							<DotsThreeIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-48">
							<DropdownMenuItem>
								<ArrowsLeftRightIcon />
								Move to vault
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive">
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
						<CopyButton value={item.username} label="username" />
					</Field>
				)}
				{item.secret && (
					<Field label={secretLabel[item.kind]}>
						<div className="min-w-0 flex-1">
							<SecretValue
								value={item.secret}
								label={secretLabel[item.kind].toLowerCase()}
							/>
						</div>
					</Field>
				)}
				{item.totp && (
					<Field label="One-time code">
						<OneTimeCode seed={item.id} />
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
							<span className="truncate">{new URL(item.url).host}</span>
							<ArrowSquareOutIcon className="size-3.5 shrink-0" />
						</a>
					</Field>
				)}
				<Field label="Reference">
					<code className="text-caption text-fg-muted min-w-0 flex-1 truncate font-mono">
						{reference}
					</code>
					<CopyButton value={reference} label="reference" />
				</Field>
				{item.notes && (
					<Field label="Notes">
						<p className="text-body-sm text-fg leading-relaxed">{item.notes}</p>
					</Field>
				)}
				{item.tags.length > 0 && (
					<Field label="Tags">
						<div className="flex flex-wrap gap-1">
							{item.tags.map((tag) => (
								<Badge key={tag} variant="secondary">
									{tag}
								</Badge>
							))}
						</div>
					</Field>
				)}
			</dl>

			<div className="border-line-subtle mt-2 flex flex-col gap-2 border-t p-4">
				<div className="flex items-center justify-between">
					<h3 className="text-body-sm text-fg">Agent access</h3>
					<Button variant="ghost" size="xs">
						<PlusIcon data-icon="inline-start" />
						Grant access
					</Button>
				</div>
				{withAccess.length === 0 ? (
					<p className="text-caption text-fg-subtle">
						No agent can use this item. Grant access to let an agent inject it
						with mima run, without seeing the value.
					</p>
				) : (
					<ul className="flex flex-col gap-1">
						{withAccess.map((agent) => (
							<li
								key={agent.id}
								className="hover:bg-tint/3 flex items-center gap-2.5 rounded-lg px-2 py-1.5"
							>
								<ItemTile kind="agent" />
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="text-body-sm text-fg">{agent.name}</span>
									<span className="text-caption text-fg-subtle truncate">
										{agent.host} ·{" "}
										{agent.expiresInDays
											? `expires in ${agent.expiresInDays}d`
											: "no expiry"}
									</span>
								</div>
								<Switch
									defaultChecked={agent.enabled}
									aria-label={`Allow ${agent.name}`}
									onCheckedChange={(checked) =>
										notify.info(
											checked
												? `${agent.name} can use ${item.name} again`
												: `${agent.name} can no longer use ${item.name}`,
										)
									}
								/>
							</li>
						))}
					</ul>
				)}
			</div>

			<footer className="rounded-b-window border-line-subtle bg-surface-sunken text-caption text-fg-subtle border-t px-4 py-2.5">
				Updated {timeAgo(item.updatedMin)} by {editor?.name ?? "someone"}
			</footer>
		</section>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex min-h-11 items-center gap-4 py-2">
			<dt className="text-caption text-fg-subtle w-28 shrink-0">{label}</dt>
			<dd className="flex min-w-0 flex-1 items-center gap-1">{children}</dd>
		</div>
	);
}
