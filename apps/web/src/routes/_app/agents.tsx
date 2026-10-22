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
	ClockIcon,
	DotsThreeIcon,
	PlusIcon,
	ShieldCheckIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { NewAgentDialog } from "@/components/agent-dialogs";
import { ApprovalCard } from "@/components/approval-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ConnectAgentCard } from "@/components/connect-agent-card";
import { ItemTile } from "@/components/item-tile";
import { notify } from "@/components/notify";
import { Page, SectionTitle } from "@/components/page";
import { ago } from "@/lib/format";
import { useLookup } from "@/lib/use-lookup";
import {
	type Agent,
	errorMessage,
	useActions,
	useAgents,
	useRequests,
} from "@/lib/vault-data";

export const Route = createFileRoute("/_app/agents")({
	component: Agents,
});

const kindLabel = { mcp: "Coding agent", cli: "Script", ci: "CI" } as const;

function Agents() {
	const agents = useAgents();
	const requests = useRequests();
	const lookup = useLookup();
	const [creating, setCreating] = useState(false);
	const pending = requests.data ?? [];
	const list = agents.data ?? [];

	return (
		<Page
			title="Agents"
			description="Agents run commands with your secrets without ever seeing them."
		>
			<SectionTitle>
				Waiting for you
				{pending.length > 0 && (
					<Badge variant="brand" className="ml-2">
						{pending.length}
					</Badge>
				)}
			</SectionTitle>
			{pending.length === 0 ? (
				<div className="rounded-window border-line text-caption text-fg-subtle mb-8 flex items-center justify-center gap-2 border border-dashed py-8">
					<ShieldCheckIcon className="size-4" />
					Nothing to approve. When an agent asks for a new item, it shows up
					here.
				</div>
			) : (
				<div className="mb-8 flex flex-col gap-3">
					{pending.map((request) => (
						<ApprovalCard key={request.id} request={request} lookup={lookup} />
					))}
				</div>
			)}

			<SectionTitle
				action={
					list.length > 0 && (
						<Button variant="ghost" size="xs" onClick={() => setCreating(true)}>
							<PlusIcon data-icon="inline-start" />
							New agent
						</Button>
					)
				}
			>
				Agents
			</SectionTitle>
			{list.length === 0 ? (
				<p className="text-caption text-fg-subtle mb-3">
					No agents yet. Create one below to let a coding agent, script or CI
					job use secrets.
				</p>
			) : (
				<section
					aria-label="Agents"
					className="rounded-window bg-surface shadow-card divide-line-subtle mb-8 flex flex-col divide-y"
				>
					{list.map((agent) => (
						<AgentRow key={agent.id} agent={agent} />
					))}
				</section>
			)}

			<SectionTitle>
				{list.length > 0 ? "Connect another agent" : "Connect an agent"}
			</SectionTitle>
			<ConnectAgentCard />
			<NewAgentDialog open={creating} onOpenChange={setCreating} />
		</Page>
	);
}

function AgentRow({ agent }: { agent: Agent }) {
	const actions = useActions();
	const [deleting, setDeleting] = useState(false);
	const expires = agent.expiresAt ? new Date(agent.expiresAt) : null;
	const expired = expires ? expires.getTime() < Date.now() : false;
	const daysLeft = expires
		? Math.ceil((expires.getTime() - Date.now()) / 86_400_000)
		: null;
	const grants = agent.grants.length;

	const run = async (work: Promise<unknown>, message: string) => {
		try {
			await work;
			notify.success(message);
		} catch (err) {
			notify.error("That didn't work", errorMessage(err));
		}
	};

	return (
		<div className="flex items-center gap-3 px-3.5 py-3">
			<ItemTile kind="agent" />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex items-center gap-2">
					<span className="text-body-sm text-fg">{agent.name}</span>
					<Badge variant="secondary">{kindLabel[agent.kind]}</Badge>
					{expired && <Badge variant="destructive">Expired</Badge>}
					{!agent.enabled && <Badge>Paused</Badge>}
				</div>
				<span className="text-caption text-fg-subtle truncate">
					{[
						agent.host ?? "not used yet",
						`owned by ${agent.ownerName}`,
						`${grants} ${grants === 1 ? "item" : "items"}`,
						expires
							? expired
								? "access expired"
								: `expires in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`
							: "no expiry",
					].join(" · ")}
				</span>
			</div>
			<div className="text-caption flex w-28 flex-col items-end gap-0.5">
				<span className="text-fg tabular-nums">
					{agent.runsThisWeek} {agent.runsThisWeek === 1 ? "run" : "runs"} this
					week
				</span>
				<span className="text-fg-subtle">
					{agent.lastSeenAt ? `seen ${ago(agent.lastSeenAt)}` : "never seen"}
				</span>
			</div>
			<Switch
				checked={agent.enabled}
				aria-label={`${agent.name} enabled`}
				onCheckedChange={(checked) =>
					run(
						actions.updateAgent(agent.id, { enabled: checked }),
						checked
							? `${agent.name} is on`
							: `${agent.name} is paused; its token stops working now`,
					)
				}
			/>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`${agent.name} options`}
						/>
					}
				>
					<DotsThreeIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					{[7, 30].map((days) => (
						<DropdownMenuItem
							key={days}
							onClick={() =>
								run(
									actions.updateAgent(agent.id, { extendDays: days }),
									`${agent.name} extended by ${days} days`,
								)
							}
						>
							<ClockIcon />
							Extend {days} days
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => setDeleting(true)}
					>
						<TrashIcon />
						Delete agent
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title={`Delete ${agent.name}?`}
				description="Its token stops working and every item it could use is revoked. This can't be undone."
				confirm="Delete agent"
				destructive
				onConfirm={() =>
					run(actions.deleteAgent(agent.id), `Deleted ${agent.name}`)
				}
			/>
		</div>
	);
}
