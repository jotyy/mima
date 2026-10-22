import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { cn } from "@mima/ui/lib/utils";

import {
	type ActivityEvent,
	findAgent,
	findItem,
	findMember,
	findVault,
} from "@/fixtures/vault";
import { initials, timeAgo, toneDot } from "@/lib/format";

import { ItemTile } from "./item-tile";

export function ActivityRow({
	event,
	compact,
}: {
	event: ActivityEvent;
	compact?: boolean;
}) {
	const item = findItem(event.itemId);
	const vault = item && findVault(item.vaultId);
	const name =
		event.actor.kind === "agent"
			? findAgent(event.actor.id)?.name
			: findMember(event.actor.id)?.name;

	return (
		<li
			className={cn(
				"flex items-center gap-3",
				compact ? "px-2 py-2" : "px-3.5 py-2.5",
			)}
		>
			{event.actor.kind === "agent" ? (
				<ItemTile kind="agent" />
			) : (
				<Avatar size="sm">
					<AvatarFallback>{initials(name ?? "?")}</AvatarFallback>
				</Avatar>
			)}
			<p className="text-body-sm text-fg-muted min-w-0 flex-1 truncate">
				<span className="text-fg">{name}</span> {event.action}{" "}
				<span className="text-fg">{item?.name}</span>
				{event.detail && !compact && (
					<span className="text-fg-subtle">
						{" "}
						· {event.action === "injected" ? "into " : ""}
						{event.detail}
					</span>
				)}
			</p>
			{vault && !compact && (
				<span className="text-caption text-fg-subtle flex items-center gap-1.5">
					<span className={`size-1.5 rounded-full ${toneDot[vault.tone]}`} />
					{vault.name}
				</span>
			)}
			<time className="text-caption text-fg-subtle w-16 shrink-0 text-right tabular-nums">
				{timeAgo(event.min)}
			</time>
		</li>
	);
}
