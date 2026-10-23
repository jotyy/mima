import { cn } from "@mima/ui/lib/utils";
import {
	ArrowCounterClockwiseIcon,
	CheckCircleIcon,
	RobotIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

// A coding agent runs the tests through `mima run`: mima asks a person, the person
// approves in mima, and the command gets the value without the agent ever seeing it.
// Plays once when it comes into view, then waits to be replayed.

type Step = { at: number; line?: ReactNode; approval?: "asking" | "approved" };

const steps: Step[] = [
	{
		at: 300,
		line: (
			<span className="text-terminal-dim">
				<span className="text-terminal-warm">✻ Claude Code</span> › Run the API
				tests against staging
			</span>
		),
	},
	{
		at: 1100,
		line: (
			<span>
				<span className="text-terminal-faint">$</span> mima run -- bun test api
			</span>
		),
	},
	{
		at: 1900,
		line: (
			<span>
				<Tag /> Claude Code asked for{" "}
				<span className="text-white">Postgres · staging</span>
			</span>
		),
	},
	{
		at: 2400,
		approval: "asking",
		line: (
			<span className="text-terminal-dim">
				<Tag /> Waiting for someone to allow it in mima…
			</span>
		),
	},
	{ at: 4300, approval: "approved" },
	{
		at: 4700,
		line: (
			<span>
				<Tag /> Allowed by Alex Kim. Starting bun test api
			</span>
		),
	},
	{
		at: 5400,
		line: (
			<span>
				<span className="text-terminal-ok">✓</span> 42 pass{" "}
				<span className="text-terminal-faint">· 0 fail · 1.84s</span>
			</span>
		),
	},
	{
		at: 5900,
		line: (
			<span className="text-terminal-dim">
				connected to <span className="text-terminal-link">postgres://app:</span>
				<span className="text-terminal-faint">********</span>
				<span className="text-terminal-link">@db.staging</span>
			</span>
		),
	},
];

const END = 6400;

function Tag() {
	return <span className="text-terminal-link">mima</span>;
}

export default function AgentsDemo() {
	const [time, setTime] = useState(0);
	const [run, setRun] = useState(0);
	const root = useRef<HTMLDivElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `run` restarts it for Replay
	useEffect(() => {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
			setTime(END);
			return;
		}
		let frame = 0;
		let start = 0;
		const tick = (now: number) => {
			if (!start) start = now;
			const elapsed = now - start;
			setTime(elapsed);
			if (elapsed < END) frame = requestAnimationFrame(tick);
		};
		const observer = new IntersectionObserver(
			([entry]) => {
				if (!entry?.isIntersecting) return;
				observer.disconnect();
				frame = requestAnimationFrame(tick);
			},
			{ threshold: 0.45 },
		);
		if (root.current) observer.observe(root.current);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [run]);

	const shown = steps.filter((step) => step.at <= time);
	const approval = shown.reduce<Step["approval"]>(
		(state, step) => step.approval ?? state,
		undefined,
	);
	const done = time >= END;

	return (
		<div ref={root} className="relative pb-24 sm:pb-16">
			<div className="bg-terminal shadow-float rounded-2xl ring-1 ring-black/40">
				<div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
					<span className="size-2.5 rounded-full bg-white/15" />
					<span className="size-2.5 rounded-full bg-white/15" />
					<span className="size-2.5 rounded-full bg-white/15" />
					<span className="text-micro ml-2 font-mono text-white/40">
						~/acme/api
					</span>
					{done && (
						<button
							type="button"
							onClick={() => {
								setTime(0);
								setRun((n) => n + 1);
							}}
							className="text-micro ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-white/50 transition-colors hover:bg-white/8 hover:text-white"
						>
							<ArrowCounterClockwiseIcon className="size-3" />
							Replay
						</button>
					)}
				</div>
				<div
					aria-live="off"
					className="text-label text-terminal-fg flex min-h-72 flex-col gap-1.5 px-5 py-5 font-mono leading-relaxed"
				>
					{shown
						.filter((step) => step.line)
						.map((step) => (
							<div
								key={step.at}
								className="animate-in fade-in slide-in-from-bottom-1 duration-300"
							>
								{step.line}
							</div>
						))}
					{!done && (
						<span className="bg-terminal-fg/70 mt-0.5 h-4 w-2 animate-pulse" />
					)}
				</div>
			</div>

			{/* The request, as a person sees it in mima */}
			<div
				className={cn(
					"bg-surface shadow-popover ring-line-subtle ease-emphasized absolute right-3 bottom-0 left-10 rounded-2xl p-4 ring-1 transition-all duration-500 sm:left-auto sm:w-88 lg:-right-8",
					approval
						? "translate-y-0 opacity-100"
						: "pointer-events-none translate-y-3 opacity-0",
				)}
			>
				<div className="flex items-start gap-3">
					<span className="bg-brand-soft text-brand flex size-8 shrink-0 items-center justify-center rounded-lg">
						<RobotIcon className="size-4" />
					</span>
					<div className="flex min-w-0 flex-col gap-0.5">
						<span className="text-label text-fg font-medium">
							Claude Code wants Postgres · staging
						</span>
						<span className="text-micro text-fg-subtle">
							For <code className="font-mono">bun test api</code> · just now
						</span>
					</div>
				</div>
				<div className="mt-4 flex items-center justify-end gap-2">
					{approval === "approved" ? (
						<span className="text-label text-success flex items-center gap-1.5">
							<CheckCircleIcon weight="fill" className="size-4" />
							Allowed by you
						</span>
					) : (
						<>
							<span className="text-label text-fg-muted rounded-full px-3 py-1.5">
								Deny
							</span>
							<span className="text-label text-fg-muted bg-surface-sunken rounded-full px-3 py-1.5">
								For 1 hour
							</span>
							<span className="text-label bg-brand text-brand-fg shadow-sheen flex items-center gap-1.5 rounded-full px-3 py-1.5">
								<ShieldCheckIcon className="size-3.5" />
								Allow once
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
