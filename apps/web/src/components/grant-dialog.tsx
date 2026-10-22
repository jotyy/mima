import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
	type Duration,
	errorMessage,
	type Item,
	itemReference,
	useActions,
	useAgents,
} from "@/lib/vault-data";

import { CopyButton } from "./copy-button";
import { notify } from "./notify";

export function GrantDialog({
	item,
	open,
	onOpenChange,
}: {
	item: Item;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const agents = useAgents();
	const actions = useActions();
	const reference = itemReference(item);
	const available = (agents.data ?? []).filter(
		(agent) =>
			agent.enabled && !agent.grants.some((grant) => grant.itemId === item.id),
	);
	const [agentId, setAgentId] = useState("");
	const [duration, setDuration] = useState<Duration>("always");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) setAgentId(available[0]?.id ?? "");
	}, [open, available[0]?.id]);

	const choices = available.map((agent) => ({
		value: agent.id,
		label: agent.name,
	}));

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Use {item.name} with an agent</DialogTitle>
					<DialogDescription>
						Put this reference in an .env file and run the command with mima
						run. The value goes into the command, never into the agent's output,
						and the first run waits for your approval.
					</DialogDescription>
				</DialogHeader>
				<div className="border-line bg-surface-sunken flex items-center gap-2 rounded-lg border py-1 pr-1 pl-3">
					<code className="text-caption text-fg min-w-0 flex-1 truncate font-mono">
						{reference}
					</code>
					<CopyButton value={reference} label="reference" secret={false} />
				</div>
				<div className="mt-2 flex flex-col gap-0.5">
					<h3 className="text-body-sm text-fg">Skip the approval</h3>
					<p className="text-caption text-fg-muted">
						Let one agent use it without asking each time.
					</p>
				</div>
				{choices.length === 0 ? (
					<p className="border-line text-caption text-fg-muted rounded-lg border border-dashed px-3 py-4 text-center">
						{agents.data?.length
							? "Every agent can already use it."
							: "No agents yet."}{" "}
						<Link to="/agents" className="text-link hover:underline">
							Create an agent
						</Link>
					</p>
				) : (
					<div className="flex flex-col gap-3">
						<Select
							items={choices}
							value={agentId}
							onValueChange={(value) => value && setAgentId(String(value))}
						>
							<SelectTrigger className="w-full" aria-label="Agent">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{choices.map((choice) => (
									<SelectItem key={choice.value} value={choice.value}>
										{choice.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Tabs
							value={duration}
							onValueChange={(value) => setDuration(value as Duration)}
						>
							<TabsList>
								<TabsTrigger value="hour">For 1 hour</TabsTrigger>
								<TabsTrigger value="day">For 1 day</TabsTrigger>
								<TabsTrigger value="always">Until I revoke it</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{choices.length === 0 ? "Done" : "Cancel"}
					</Button>
					<Button
						hidden={choices.length === 0}
						disabled={!agentId || busy}
						onClick={async () => {
							const agent = available.find((a) => a.id === agentId);
							if (!agent) return;
							setBusy(true);
							try {
								await actions.grant(agent, item, duration);
								notify.success(`${agent.name} can use ${item.name}`);
								onOpenChange(false);
							} catch (err) {
								notify.error("Couldn't grant access", errorMessage(err));
							} finally {
								setBusy(false);
							}
						}}
					>
						Grant access
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
