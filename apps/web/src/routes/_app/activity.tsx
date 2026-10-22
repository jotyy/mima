import { Avatar, AvatarFallback } from "@mima/ui/components/avatar";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ItemTile } from "@/components/item-tile";
import { Page } from "@/components/page";
import { StatCard } from "@/components/stat-card";
import {
	type ActivityEvent,
	activity,
	findAgent,
	findItem,
	findMember,
	findVault,
} from "@/fixtures/vault";
import { initials, timeAgo, toneDot } from "@/lib/format";

export const Route = createFileRoute("/_app/activity")({
	component: Activity,
});

const verb: Record<ActivityEvent["action"], string> = {
	revealed: "revealed",
	copied: "copied",
	injected: "injected",
	approved: "approved",
	denied: "denied",
	created: "created",
	updated: "updated",
	shared: "shared",
};

function Activity() {
	const [who, setWho] = useState("all");
	const events = activity.filter(
		(event) => who === "all" || event.actor.kind === who,
	);
	const today = activity.filter((event) => event.min < 60 * 24);

	return (
		<Page
			title="Activity"
			description="Every reveal, copy and agent run, newest first. Nothing here can be edited."
		>
			<div className="mb-3 grid grid-cols-3 gap-3">
				<StatCard
					label="Events today"
					value={today.length}
					note="by people and agents"
				/>
				<StatCard
					label="Agent injections"
					value={today.filter((e) => e.action === "injected").length}
					note="values never left mima"
				/>
				<StatCard
					label="Denied"
					value={activity.filter((e) => e.action === "denied").length}
					note="in the last 7 days"
				/>
			</div>

			<section className="rounded-window bg-surface shadow-card flex flex-col">
				<div className="border-line-subtle flex items-center justify-between border-b p-1.5">
					<Tabs value={who} onValueChange={(value) => setWho(String(value))}>
						<TabsList variant="ghost">
							<TabsTrigger value="all">Everyone</TabsTrigger>
							<TabsTrigger value="member">People</TabsTrigger>
							<TabsTrigger value="agent">Agents</TabsTrigger>
						</TabsList>
					</Tabs>
					<span className="text-caption text-fg-subtle mr-2">
						{events.length} events
					</span>
				</div>
				<ol className="divide-line-subtle flex flex-col divide-y">
					{events.map((event) => (
						<EventRow key={event.id} event={event} />
					))}
				</ol>
			</section>
		</Page>
	);
}

function EventRow({ event }: { event: ActivityEvent }) {
	const item = findItem(event.itemId);
	const vault = item && findVault(item.vaultId);
	const name =
		event.actor.kind === "agent"
			? findAgent(event.actor.id)?.name
			: findMember(event.actor.id)?.name;

	return (
		<li className="flex items-center gap-3 px-3.5 py-2.5">
			{event.actor.kind === "agent" ? (
				<ItemTile kind="agent" />
			) : (
				<Avatar size="sm">
					<AvatarFallback>{initials(name ?? "?")}</AvatarFallback>
				</Avatar>
			)}
			<p className="text-body-sm text-fg-muted min-w-0 flex-1 truncate">
				<span className="text-fg">{name}</span> {verb[event.action]}{" "}
				<span className="text-fg">{item?.name}</span>
				{event.detail && (
					<span className="text-fg-subtle">
						{" "}
						· {event.action === "injected" ? "into " : ""}
						{event.detail}
					</span>
				)}
			</p>
			{vault && (
				<span className="text-caption text-fg-subtle flex items-center gap-1.5">
					<span className={`size-1.5 rounded-full ${toneDot[vault.tone]}`} />
					{vault.name}
				</span>
			)}
			<time className="text-caption text-fg-subtle w-16 text-right tabular-nums">
				{timeAgo(event.min)}
			</time>
		</li>
	);
}
