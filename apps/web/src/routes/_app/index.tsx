import { Button } from "@mima/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { ConnectAgentCard } from "@/components/connect-agent-card";
import { Page } from "@/components/page";
import { RunsChart } from "@/components/runs-chart";
import { StatCard } from "@/components/stat-card";
import { agentRuns, approvalRequests, items, vaults } from "@/fixtures/vault";
import { timeAgo } from "@/lib/format";

export const Route = createFileRoute("/_app/")({
	component: Overview,
});

const kinds = [
	{ value: "all", label: "Everything" },
	{ value: "login", label: "Logins" },
	{ value: "api-key", label: "API keys" },
	{ value: "note", label: "Notes" },
	{ value: "ssh-key", label: "SSH keys" },
];

function Overview() {
	const navigate = useNavigate();
	const [kind, setKind] = useState("all");
	const [query, setQuery] = useState("");

	const runsThisWeek = agentRuns
		.slice(-7)
		.reduce((sum, day) => sum + day.allowed + day.approval + day.denied, 0);
	const neededApproval = agentRuns
		.slice(-7)
		.reduce((sum, day) => sum + day.approval, 0);
	const weak = items.filter((item) => item.strength === "weak");
	const oldest = Math.max(...approvalRequests.map((r) => r.requestedMin));

	const search = () =>
		navigate({
			to: "/items",
			search: {
				q: query || undefined,
				kind: kind === "all" ? undefined : kind,
			},
		});

	return (
		<Page
			title="Overview"
			description="Find a secret, then see who and what used it."
		>
			<div className="rounded-window border-line-subtle bg-surface-sunken border">
				<form
					className="rounded-window bg-surface shadow-card"
					onSubmit={(event) => {
						event.preventDefault();
						search();
					}}
				>
					<div className="flex items-center justify-between p-1.5">
						<Tabs
							value={kind}
							onValueChange={(value) => setKind(String(value))}
						>
							<TabsList>
								{kinds.map((k) => (
									<TabsTrigger key={k.value} value={k.value}>
										{k.label}
									</TabsTrigger>
								))}
							</TabsList>
						</Tabs>
						<Link
							to="/items"
							className="text-caption text-fg-muted hover:text-fg mr-1.5 flex items-center gap-1"
						>
							All items
							<ArrowUpRightIcon className="size-3" />
						</Link>
					</div>
					<div className="flex h-11 items-center gap-2 pr-1.5 pl-3.5">
						<MagnifyingGlassIcon className="text-fg-subtle size-4" />
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={`Search ${items.length} items in ${vaults.length} vaults`}
							className="text-fg text-input min-w-0 flex-1 bg-transparent outline-none"
						/>
						<Button
							type="submit"
							variant="brand"
							size="icon"
							aria-label="Search"
						>
							<ArrowRightIcon />
						</Button>
					</div>
				</form>
				<p className="text-caption text-fg-muted py-2 text-center">
					Press ⌘K to search from anywhere
				</p>
			</div>

			<div className="mt-3 grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-3">
					<RunsChart />
					<div className="grid grid-cols-2 gap-3">
						<StatCard
							label="Items"
							value={items.length}
							note={`in ${vaults.length} vaults`}
							to="/items"
						/>
						<StatCard
							label="Agent runs this week"
							value={runsThisWeek}
							note={`${neededApproval} needed approval`}
							to="/activity"
						/>
						<StatCard
							label="Waiting for approval"
							value={approvalRequests.length}
							note={`oldest ${timeAgo(oldest)}`}
							to="/agents"
						/>
						<StatCard
							label="Weak passwords"
							value={weak.length}
							note={weak.map((item) => item.name).join(", ")}
							to="/items"
						/>
					</div>
				</div>
				<ConnectAgentCard />
			</div>
		</Page>
	);
}
