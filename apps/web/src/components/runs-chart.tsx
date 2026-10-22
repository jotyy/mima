import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { ChartBarIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { agentRuns } from "@/fixtures/vault";

const series = [
	{ key: "allowed", label: "Allowed", color: "bg-chart-5" },
	{ key: "approval", label: "Needed approval", color: "bg-chart-4" },
	{ key: "denied", label: "Denied", color: "bg-danger" },
] as const;

export function RunsChart() {
	const [range, setRange] = useState("14d");
	const days = range === "7d" ? agentRuns.slice(-7) : agentRuns;
	const max = Math.max(
		...days.map((day) => day.allowed + day.approval + day.denied),
	);
	const top = Math.ceil(max / 4) * 4;
	const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-2">
			<div className="flex items-center justify-between pl-1.5">
				<div className="text-body-sm text-fg flex items-center gap-2">
					<ChartBarIcon className="text-brand size-4" />
					Agent runs
				</div>
				<Tabs value={range} onValueChange={(value) => setRange(String(value))}>
					<TabsList variant="ghost">
						<TabsTrigger value="7d">7D</TabsTrigger>
						<TabsTrigger value="14d">14D</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>
			<div className="mt-4 flex gap-2 px-1.5">
				<div className="text-caption text-fg-subtle flex h-40 flex-col justify-between pb-0.5 text-right tabular-nums">
					{ticks.map((tick) => (
						<span key={tick} className="leading-none">
							{tick}
						</span>
					))}
				</div>
				<div className="border-line-subtle relative flex h-40 flex-1 items-end gap-1 border-b">
					<div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
						{ticks.slice(0, -1).map((tick) => (
							<span key={tick} className="bg-line-subtle h-px" />
						))}
					</div>
					{days.map((day, index) => (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: days are positional
							key={index}
							className="relative flex h-full flex-1 flex-col-reverse items-center"
						>
							{series.map(({ key, color }) =>
								day[key] ? (
									<span
										key={key}
										className={`w-2 first:rounded-b-xs last:rounded-t-xs ${color}`}
										style={{ height: `${(day[key] / top) * 100}%` }}
									/>
								) : null,
							)}
						</div>
					))}
				</div>
			</div>
			<div className="text-caption text-fg-subtle mt-1.5 flex justify-between pr-1.5 pl-9">
				<span>{range === "7d" ? "7 days ago" : "14 days ago"}</span>
				<span>Today</span>
			</div>
			<div className="text-caption text-fg-muted mt-3 flex gap-3 px-1.5 pb-1">
				{series.map(({ key, label, color }) => (
					<span key={key} className="flex items-center gap-1.5">
						<span className={`size-1.5 rounded-full ${color}`} />
						{label}
					</span>
				))}
			</div>
		</section>
	);
}
