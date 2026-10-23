import { CopyIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@vauly/ui/components/tabs";
import { cn } from "@vauly/ui/lib/utils";
import { type ReactNode, useState } from "react";

import { useItems } from "@/lib/vault-data";

import { CopyButton } from "./copy-button";
import { ItemTile } from "./item-tile";
import { copyToClipboard } from "./notify";

const prompts = {
	agent:
		"This project keeps secrets in vauly. Values in .env are vauly:// references: start commands with `vauly run -- <command>` so they get the real values. Never print, log or commit secret values, and never try to read them another way. If vauly says a secret is waiting for approval, tell me and wait.",
	app: "Replace each secret in .env with its vauly:// reference from vauly, keep .env out of git, and start the app with `vauly run -- bun run dev`.",
};

/**
 * How to hook up an agent, in four steps. With `first`, it's the whole Agents page
 * while there are none yet, so it also says what an agent is. The page owns the New
 * agent dialog: creating the first agent replaces this card, and the token must stay.
 */
export function ConnectAgentCard({
	first = false,
	onNewAgent,
}: {
	first?: boolean;
	onNewAgent: () => void;
}) {
	const items = useItems();
	const [prompt, setPrompt] = useState<"agent" | "app">("agent");
	const example = items.data?.find(
		(item) => item.secret && item.kind !== "login",
	);
	const envLine = `DATABASE_URL=vauly://${example?.id ?? "itm_…"}`;
	const runLine = "vauly run -- bun run dev";

	return (
		<section
			aria-label={first ? "Connect your first agent" : "Connect an agent"}
			className="rounded-window bg-surface shadow-card flex flex-col p-5"
		>
			{first && (
				<div className="border-line-subtle mb-5 flex items-start gap-3.5 border-b pb-5">
					<ItemTile kind="agent" size="lg" />
					<div className="flex flex-col gap-1">
						<h2 className="text-body text-fg font-medium">
							Connect your first agent
						</h2>
						<p className="text-body-sm text-fg-subtle text-pretty">
							No agents yet. A coding agent, script or CI job gets its own token
							and asks for secrets by reference. You approve each one once; the
							value goes into its command, never to the agent.
						</p>
					</div>
				</div>
			)}

			<ol className="flex flex-col">
				<Step n={1} title="Create an agent and store its token">
					<Button
						variant={first ? "brand" : "outline"}
						className="w-fit"
						onClick={onNewAgent}
					>
						<PlusIcon data-icon="inline-start" />
						New agent
					</Button>
				</Step>

				<Step n={2} title="Point your .env at vauly instead of real values">
					<Snippet value={envLine} label=".env line" />
				</Step>

				<Step n={3} title="Run commands through vauly">
					<Snippet value={runLine} label="command" />
					<p className="text-caption text-fg-subtle text-pretty">
						The first time a command needs an item, you approve it here. The
						value goes into the command's environment; the agent never sees it.
					</p>
				</Step>

				<Step n={4} title="Tell the agent how to work" last>
					<div className="border-line overflow-hidden rounded-lg border">
						<div className="border-line-subtle flex items-center gap-2 border-b p-1">
							<Tabs
								value={prompt}
								onValueChange={(value) => setPrompt(value as "agent" | "app")}
							>
								<TabsList variant="ghost">
									<TabsTrigger value="agent">Add to agent</TabsTrigger>
									<TabsTrigger value="app">Set up a project</TabsTrigger>
								</TabsList>
							</Tabs>
							<Button
								className="ml-auto"
								onClick={() =>
									copyToClipboard(prompts[prompt], {
										label: "prompt",
										secret: false,
									})
								}
							>
								<CopyIcon data-icon="inline-start" />
								Copy
							</Button>
						</div>
						<p className="text-body-sm text-fg px-3 py-3 leading-relaxed">
							{prompts[prompt]}
						</p>
					</div>
				</Step>
			</ol>
		</section>
	);
}

function Snippet({ value, label }: { value: string; label: string }) {
	return (
		<div className="border-line bg-surface-sunken flex items-center gap-1 rounded-lg border py-1 pr-1 pl-3">
			<code className="text-caption text-fg-muted min-w-0 flex-1 truncate font-mono">
				{value}
			</code>
			<CopyButton value={value} label={label} secret={false} />
		</div>
	);
}

/** A numbered step, joined to the next one by a thin line. */
function Step({
	n,
	title,
	last = false,
	children,
}: {
	n: number;
	title: string;
	last?: boolean;
	children: ReactNode;
}) {
	return (
		<li className="flex gap-3.5">
			<div className="flex flex-col items-center">
				<span className="border-line text-caption text-fg-muted flex size-6 shrink-0 items-center justify-center rounded-full border tabular-nums">
					{n}
				</span>
				{!last && <span aria-hidden className="bg-line my-1 w-px flex-1" />}
			</div>
			<div
				className={cn(
					"flex min-w-0 flex-1 flex-col gap-2.5 pt-0.5",
					!last && "pb-6",
				)}
			>
				<span className="text-body-sm text-fg">{title}</span>
				{children}
			</div>
		</li>
	);
}
