import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import { Switch } from "@mima/ui/components/switch";
import { PlusIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConnectAgentCard } from "@/components/connect-agent-card";
import { ItemTile } from "@/components/item-tile";
import { notify } from "@/components/notify";
import { Page, SectionTitle } from "@/components/page";
import {
	type ApprovalRequest,
	agents,
	approvalRequests,
	findAgent,
	findItem,
	findMember,
	itemReference,
} from "@/fixtures/vault";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_app/agents")({
	component: Agents,
});

function Agents() {
	const [requests, setRequests] = useState(approvalRequests);

	const settle = (request: ApprovalRequest, outcome: string) => {
		setRequests((current) => current.filter((r) => r.id !== request.id));
		const agent = findAgent(request.agentId);
		const item = findItem(request.itemId);
		notify.success(outcome, `${agent?.name} → ${item?.name}`);
	};

	return (
		<Page
			title="Agents"
			description="Agents use secrets through mima without ever seeing them."
		>
			<SectionTitle>
				Waiting for you
				{requests.length > 0 && (
					<Badge variant="brand" className="ml-2">
						{requests.length}
					</Badge>
				)}
			</SectionTitle>
			{requests.length === 0 ? (
				<div className="rounded-window border-line text-caption text-fg-subtle mb-8 flex items-center justify-center gap-2 border border-dashed py-8">
					<ShieldCheckIcon className="size-4" />
					Nothing to approve. New requests show up here and on your phone.
				</div>
			) : (
				<div className="mb-8 flex flex-col gap-3">
					{requests.map((request) => (
						<ApprovalCard
							key={request.id}
							request={request}
							onSettle={settle}
						/>
					))}
				</div>
			)}

			<SectionTitle
				action={
					<Button variant="ghost" size="xs">
						<PlusIcon data-icon="inline-start" />
						New agent
					</Button>
				}
			>
				Agents
			</SectionTitle>
			<section className="divide-line-subtle rounded-window bg-surface shadow-card mb-8 flex flex-col divide-y">
				{agents.map((agent) => {
					const owner = findMember(agent.ownerId);
					return (
						<div key={agent.id} className="flex items-center gap-3 px-3.5 py-3">
							<ItemTile kind="agent" />
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-2">
									<span className="text-body-sm text-fg">{agent.name}</span>
									<Badge variant="secondary">{agent.kind}</Badge>
								</div>
								<span className="text-caption text-fg-subtle truncate">
									{agent.host} · owned by {owner?.name} · {agent.itemIds.length}{" "}
									{agent.itemIds.length === 1 ? "item" : "items"} ·{" "}
									{agent.expiresInDays
										? `expires in ${agent.expiresInDays}d`
										: "no expiry"}
								</span>
							</div>
							<div className="text-caption flex w-28 flex-col items-end gap-0.5">
								<span className="text-fg tabular-nums">
									{agent.runsThisWeek} runs
								</span>
								<span className="text-fg-subtle">
									seen {timeAgo(agent.lastSeenMin)}
								</span>
							</div>
							<Switch
								defaultChecked={agent.enabled}
								aria-label={`Enable ${agent.name}`}
								onCheckedChange={(checked) =>
									notify.info(
										checked
											? `${agent.name} is enabled`
											: `${agent.name} is paused. Its token stops working right away.`,
									)
								}
							/>
						</div>
					);
				})}
			</section>

			<SectionTitle>Connect another agent</SectionTitle>
			<ConnectAgentCard />
		</Page>
	);
}

function ApprovalCard({
	request,
	onSettle,
}: {
	request: ApprovalRequest;
	onSettle: (request: ApprovalRequest, outcome: string) => void;
}) {
	const agent = findAgent(request.agentId);
	const item = findItem(request.itemId);
	const owner = agent && findMember(agent.ownerId);
	if (!agent || !item) return null;

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col">
			<div className="flex items-start gap-3 p-3.5">
				<ItemTile kind="agent" />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="text-body-sm text-fg">
						<span className="font-medium">{agent.name}</span> wants to use{" "}
						<span className="font-medium">{item.name}</span>
					</p>
					<p className="text-caption text-fg-subtle">
						{agent.host} · {owner?.name} · {timeAgo(request.requestedMin)}
					</p>
				</div>
				<Badge variant="warning">First use</Badge>
			</div>
			<div className="bg-surface-sunken text-caption mx-3.5 mb-3.5 flex flex-col gap-1 rounded-lg px-3 py-2.5 font-mono">
				<span className="text-fg-subtle">$ mima run -- {request.command}</span>
				<span className="text-fg-muted">injects {itemReference(item)}</span>
			</div>
			<div className="rounded-b-window border-line-subtle bg-surface-sunken flex items-center justify-end gap-2 border-t px-3.5 py-2.5">
				<span className="text-caption text-fg-subtle mr-auto">
					The value goes to the command, never to the agent.
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onSettle(request, "Denied")}
				>
					Deny
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onSettle(request, "Allowed once")}
				>
					Allow once
				</Button>
				<Button
					size="sm"
					onClick={() => onSettle(request, "Allowed for 1 hour")}
				>
					Allow for 1 hour
				</Button>
			</div>
		</section>
	);
}
