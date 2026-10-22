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
	useActions,
	useAgents,
} from "@/lib/vault-data";

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
					<DialogTitle>Let an agent use {item.name}</DialogTitle>
					<DialogDescription>
						The agent gets the value inside the commands it runs with mima run.
						It never sees the value itself, and you can revoke it any time.
					</DialogDescription>
				</DialogHeader>
				{choices.length === 0 ? (
					<p className="border-line text-caption text-fg-muted rounded-lg border border-dashed px-3 py-4 text-center">
						Every agent already has access, or there are none yet.{" "}
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
						Cancel
					</Button>
					<Button
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
