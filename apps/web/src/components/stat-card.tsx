import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function StatCard({
	label,
	value,
	note,
	to,
}: {
	label: string;
	value: ReactNode;
	note: ReactNode;
	to?: "/agents" | "/items" | "/activity";
}) {
	const body = (
		<>
			<div className="text-caption text-fg-muted flex items-center justify-between">
				{label}
				{to && (
					<ArrowUpRightIcon className="text-fg-subtle group-hover/stat:text-fg size-3.5 transition-colors" />
				)}
			</div>
			<div className="text-fg text-stat mt-3.5 tabular-nums">{value}</div>
			<div className="text-caption text-fg-subtle mt-3">{note}</div>
		</>
	);
	const className =
		"group/stat flex flex-col rounded-window bg-surface p-3.5 shadow-card";
	return to ? (
		<Link
			to={to}
			className={`${className} hover:shadow-popover transition-shadow`}
		>
			{body}
		</Link>
	) : (
		<div className={className}>{body}</div>
	);
}
