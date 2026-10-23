import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { cn } from "@mima/ui/lib/utils";
import { LinkSimpleIcon } from "@phosphor-icons/react";

import { describeEvent } from "@/lib/describe-event";
import { ago, initials, toneDot } from "@/lib/format";
import type { useLookup } from "@/lib/use-lookup";
import type { VaultEvent } from "@/lib/vault-data";

import { ItemTile } from "./item-tile";

export function ActivityRow({
	event,
	lookup,
	compact,
	inItem,
}: {
	event: VaultEvent;
	lookup: ReturnType<typeof useLookup>;
	compact?: boolean;
	/** Shown on the item itself, so its name goes without saying. */
	inItem?: boolean;
}) {
	const text = describeEvent(event, lookup);
	// "revealed the password of" reads "revealed the password" on the item itself.
	const verb = inItem
		? text.verb.replace(/ (of|to|from)$/, "").replace(/ use$/, " use it")
		: text.verb;

	return (
		<li
			className={cn(
				"flex items-center gap-3",
				compact ? "px-2 py-2" : "px-3.5 py-2.5",
			)}
		>
			{event.actorType === "agent" ? (
				<ItemTile kind="agent" />
			) : event.actorType === "link" ? (
				<span className="bg-surface-sunken text-fg-muted flex size-6 shrink-0 items-center justify-center rounded-full">
					<LinkSimpleIcon className="size-3.5" />
				</span>
			) : (
				<Avatar size="sm">
					<AvatarFallback>{initials(event.actorName)}</AvatarFallback>
				</Avatar>
			)}
			<p className="text-body-sm text-fg-muted min-w-0 flex-1 truncate">
				<span className="text-fg">{text.actor}</span> {verb}
				{text.object && !inItem && (
					<span className="text-fg"> {text.object}</span>
				)}
				{text.detail && !compact && (
					<span className="text-fg-subtle"> · {text.detail}</span>
				)}
			</p>
			{text.vault && !compact && (
				<span className="text-caption text-fg-subtle flex shrink-0 items-center gap-1.5">
					<span
						className={`size-1.5 rounded-full ${toneDot[text.vault.tone]}`}
					/>
					{text.vault.name}
				</span>
			)}
			<time
				dateTime={new Date(event.createdAt).toISOString()}
				className="text-caption text-fg-subtle w-16 shrink-0 text-right tabular-nums"
			>
				{ago(event.createdAt)}
			</time>
		</li>
	);
}
