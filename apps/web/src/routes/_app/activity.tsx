import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ActivityRow } from "@/components/activity-row";
import { Page } from "@/components/page";
import { StatCard } from "@/components/stat-card";
import { activity } from "@/fixtures/vault";

export const Route = createFileRoute("/_app/activity")({
	component: Activity,
});

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
						<ActivityRow key={event.id} event={event} />
					))}
				</ol>
			</section>
		</Page>
	);
}
