import { XIcon } from "@phosphor-icons/react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Skeleton } from "@vauly/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@vauly/ui/components/tabs";
import { useState } from "react";
import { z } from "zod";

import { ActivityRow } from "@/components/activity-row";
import { Page } from "@/components/page";
import { StatCard } from "@/components/stat-card";
import { useLookup } from "@/lib/use-lookup";
import { useEvents, useItemEvents } from "@/lib/vault-data";

export const Route = createFileRoute("/_app/activity")({
	validateSearch: z.object({ item: z.string().optional() }),
	component: Activity,
	head: () => ({ meta: [{ title: "Activity · vauly" }] }),
});

const DAY = 24 * 60 * 60 * 1000;

function Activity() {
	const { item: itemId } = Route.useSearch();
	const everything = useEvents();
	const forItem = useItemEvents(itemId, 500);
	const events = itemId ? forItem : everything;
	const lookup = useLookup();
	const [who, setWho] = useState("all");
	const all = events.data ?? [];
	const item = itemId ? lookup.items.get(itemId) : undefined;
	const shown = all.filter((event) => who === "all" || event.actorType === who);
	const since = (ms: number) =>
		all.filter((e) => Date.now() - new Date(e.createdAt).getTime() < ms);

	return (
		<Page
			title="Activity"
			description="Every reveal, copy and agent run, newest first. Nobody can edit this log."
		>
			<div className="mb-3 grid grid-cols-3 gap-3">
				<StatCard
					label="Events today"
					value={since(DAY).length}
					note="by people and agents"
				/>
				<StatCard
					label="Agent runs today"
					value={since(DAY).filter((e) => e.action === "injected").length}
					note="values went to commands, not agents"
				/>
				<StatCard
					label="Denied this week"
					value={since(7 * DAY).filter((e) => e.action === "denied").length}
					note="agent requests turned down"
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
					<span className="text-caption text-fg-subtle mr-2 flex items-center gap-2">
						{itemId && (
							<span className="bg-surface-sunken text-fg-muted flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5">
								{item?.name ?? "A deleted item"}
								<Link
									to="/activity"
									search={{}}
									aria-label="Show everything"
									className="hover:bg-tint/6 hover:text-fg flex size-4 items-center justify-center rounded-full"
								>
									<XIcon className="size-3" />
								</Link>
							</span>
						)}
						{shown.length} {shown.length === 1 ? "event" : "events"}
					</span>
				</div>
				{events.isPending ? (
					<div className="flex flex-col gap-2 p-3.5">
						<Skeleton className="h-6" />
						<Skeleton className="h-6" />
						<Skeleton className="h-6" />
					</div>
				) : shown.length === 0 ? (
					<p className="text-caption text-fg-subtle px-3.5 py-10 text-center">
						Nothing here yet.
					</p>
				) : (
					<ol
						aria-label="Events"
						className="divide-line-subtle flex flex-col divide-y"
					>
						{shown.map((event) => (
							<ActivityRow key={event.id} event={event} lookup={lookup} />
						))}
					</ol>
				)}
			</section>
		</Page>
	);
}
