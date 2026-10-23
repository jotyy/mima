import { Badge } from "@vauly/ui/components/badge";
import { Button } from "@vauly/ui/components/button";
import { useState } from "react";

import { ago } from "@/lib/format";
import type { useLookup } from "@/lib/use-lookup";
import {
	type AccessRequest,
	type Duration,
	errorMessage,
	itemReference,
	useActions,
} from "@/lib/vault-data";

import { ItemTile } from "./item-tile";
import { notify } from "./notify";

export function ApprovalCard({
	request,
	lookup,
}: {
	request: AccessRequest;
	lookup: ReturnType<typeof useLookup>;
}) {
	const actions = useActions();
	const [busy, setBusy] = useState(false);
	const agent = lookup.agents.get(request.agentId);
	const item = lookup.items.get(request.itemId);
	const agentName = agent?.name ?? "An agent";
	const itemName = item?.name ?? "an item";

	const decide = async (work: () => Promise<unknown>, message: string) => {
		setBusy(true);
		try {
			await work();
			notify.success(message);
		} catch (err) {
			notify.error("That didn't work", errorMessage(err));
		} finally {
			setBusy(false);
		}
	};
	const allow = (duration: Duration, label: string) =>
		decide(
			() => actions.approve(request, duration),
			`${agentName} can use ${itemName} ${label}`,
		);

	return (
		<section
			aria-label={`${agentName} wants ${itemName}`}
			className="rounded-window bg-surface shadow-card flex flex-col"
		>
			<div className="flex items-start gap-3 p-3.5">
				<ItemTile kind="agent" />
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<p className="text-body-sm text-fg">
						<span className="font-medium">{agentName}</span> wants to use{" "}
						<span className="font-medium">{itemName}</span>
					</p>
					<p className="text-caption text-fg-subtle">
						{[
							agent?.host,
							agent?.ownerName && `owned by ${agent.ownerName}`,
							ago(request.createdAt),
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
				<Badge variant="warning">Needs you</Badge>
			</div>
			<div className="bg-surface-sunken text-caption mx-3.5 mb-3.5 flex flex-col gap-1 rounded-lg px-3 py-2.5 font-mono">
				<span className="text-fg-muted">$ vauly run -- {request.command}</span>
				{item && (
					<span className="text-fg-subtle">injects {itemReference(item)}</span>
				)}
			</div>
			<div className="rounded-b-window border-line-subtle bg-surface-sunken flex items-center justify-end gap-2 border-t px-3.5 py-2.5">
				<span className="text-caption text-fg-subtle mr-auto">
					The value goes into the command, never to the agent.
				</span>
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() =>
						decide(() => actions.deny(request), `Denied ${agentName}`)
					}
				>
					Deny
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || !item}
					onClick={() => allow("once", "once")}
				>
					Allow once
				</Button>
				<Button
					size="sm"
					disabled={busy || !item}
					onClick={() => allow("hour", "for 1 hour")}
				>
					Allow for 1 hour
				</Button>
			</div>
		</section>
	);
}
