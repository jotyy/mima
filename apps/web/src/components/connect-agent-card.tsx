import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { CopyIcon, PlusIcon, RobotIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";

import { useItems } from "@/lib/vault-data";

import { NewAgentDialog } from "./agent-dialogs";
import { CopyButton } from "./copy-button";
import { copyToClipboard } from "./notify";

const prompts = {
	agent:
		"This project keeps secrets in mima. Values in .env are mima:// references: start commands with `mima run -- <command>` so they get the real values. Never print, log or commit secret values, and never try to read them another way. If mima says a secret is waiting for approval, tell me and wait.",
	app: "Replace each secret in .env with its mima:// reference from mima, keep .env out of git, and start the app with `mima run -- bun run dev`.",
};

export function ConnectAgentCard() {
	const items = useItems();
	const [creating, setCreating] = useState(false);
	const [prompt, setPrompt] = useState<"agent" | "app">("agent");
	const example = items.data?.find(
		(item) => item.secret && item.kind !== "login",
	);
	const envLine = `DATABASE_URL=mima://${example?.id ?? "itm_…"}`;
	const runLine = "mima run -- bun run dev";

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-3">
			<div className="border-line-subtle flex items-center gap-2.5 border-b pb-3">
				<span className="border-line text-brand flex size-7 items-center justify-center rounded-md border">
					<RobotIcon className="size-4" />
				</span>
				<span className="text-body-sm text-fg">Connect an agent</span>
			</div>

			<Step n={1} title="Create an agent and store its token">
				<Button
					variant="outline"
					className="w-fit"
					onClick={() => setCreating(true)}
				>
					<PlusIcon data-icon="inline-start" />
					New agent
				</Button>
			</Step>

			<Step n={2} title="Point your .env at mima instead of real values">
				<Snippet value={envLine} label=".env line" />
			</Step>

			<Step n={3} title="Run commands through mima">
				<Snippet value={runLine} label="command" />
				<p className="text-caption text-fg-subtle">
					The first time a command needs an item, you approve it here. The value
					goes into the command's environment; the agent never sees it.
				</p>
			</Step>

			<Step n={4} title="Tell the agent how to work">
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

			<NewAgentDialog open={creating} onOpenChange={setCreating} />
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

function Step({
	n,
	title,
	children,
}: {
	n: number;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="mt-4 flex flex-col gap-2.5">
			<div className="text-body-sm text-fg flex items-center gap-2.5">
				<Badge className="w-5 justify-center px-0">{n}</Badge>
				{title}
			</div>
			{children}
		</div>
	);
}
