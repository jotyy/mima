import { Badge } from "@mima/ui/components/badge";
import { Button } from "@mima/ui/components/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@mima/ui/components/select";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { ArrowUpRightIcon, CopyIcon, RobotIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { CopyButton } from "./copy-button";
import { SecretValue } from "./secret-value";

const agentChoices = [
	{ value: "claude-code", label: "Claude Code" },
	{ value: "cursor", label: "Cursor" },
	{ value: "codex", label: "Codex" },
];

const install: Record<string, Record<string, string>> = {
	mcp: {
		"claude-code": "claude mcp add mima -- mima mcp",
		cursor: "mima mcp install --client cursor",
		codex: "codex mcp add mima -- mima mcp",
	},
	skill: {
		"claude-code": "mima skill install --agent claude-code",
		cursor: "mima skill install --agent cursor",
		codex: "mima skill install --agent codex",
	},
	cli: {
		"claude-code": "mima run --agent claude-code -- claude",
		cursor: "mima run --agent cursor -- cursor .",
		codex: "mima run --agent codex -- codex",
	},
};

const prompts = {
	agent:
		"Use mima for every secret in this project. Read values only through mima run, never print them, and ask me before using a secret you have not used before.",
	app: "Replace the values in .env with mima references (mima://vault/item), then start the app with mima run -- bun run dev.",
};

export function ConnectAgentCard() {
	const [method, setMethod] = useState("mcp");
	const [agent, setAgent] = useState("claude-code");
	const [prompt, setPrompt] = useState<"agent" | "app">("agent");
	const command = install[method][agent];

	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col p-3">
			<div className="border-line-subtle flex items-center justify-between border-b pb-3">
				<div className="text-body-sm text-fg flex items-center gap-2.5">
					<span className="border-line text-brand flex size-7 items-center justify-center rounded-md border">
						<RobotIcon className="size-4" />
					</span>
					Connect an agent
				</div>
				<Link
					to="/agents"
					className="text-caption text-fg-muted hover:text-fg flex items-center gap-1"
				>
					Manage agents
					<ArrowUpRightIcon className="size-3" />
				</Link>
			</div>

			<Step n={1} title="Copy the agent token">
				<div className="border-line flex h-10 items-center gap-1 rounded-lg border pr-1 pl-3">
					<div className="min-w-0 flex-1">
						<SecretValue
							value="mima_agent_example_not_a_real_token"
							label="agent token"
						/>
					</div>
				</div>
			</Step>

			<Step n={2} title="Install it for your agent">
				<div className="border-line overflow-hidden rounded-lg border">
					<div className="border-line-subtle flex items-center gap-2 border-b p-1">
						<Tabs
							value={method}
							onValueChange={(value) => setMethod(String(value))}
						>
							<TabsList variant="ghost">
								<TabsTrigger value="mcp">MCP</TabsTrigger>
								<TabsTrigger value="skill">Skill</TabsTrigger>
								<TabsTrigger value="cli">CLI</TabsTrigger>
							</TabsList>
						</Tabs>
						<div className="ml-auto flex items-center gap-1">
							<CopyButton value={command} label="command" />
							<Select
								items={agentChoices}
								value={agent}
								onValueChange={(value) => value && setAgent(String(value))}
							>
								<SelectTrigger size="sm" className="text-caption">
									<SelectValue />
								</SelectTrigger>
								<SelectContent align="end">
									{agentChoices.map((choice) => (
										<SelectItem key={choice.value} value={choice.value}>
											{choice.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
					<pre className="bg-surface-sunken text-caption text-fg-muted overflow-x-auto px-3 py-3 font-mono">
						{command}
					</pre>
					<p className="border-line-subtle text-caption text-fg-subtle border-t px-3 py-2.5">
						The agent gets references, never values. You approve each new secret
						with Touch ID.
					</p>
				</div>
			</Step>

			<Step n={3} title="Tell it how to work">
				<div className="border-line overflow-hidden rounded-lg border">
					<div className="border-line-subtle flex items-center gap-2 border-b p-1">
						<Tabs
							value={prompt}
							onValueChange={(value) => setPrompt(value as "agent" | "app")}
						>
							<TabsList variant="ghost">
								<TabsTrigger value="agent">Add to agent</TabsTrigger>
								<TabsTrigger value="app">Build into app</TabsTrigger>
							</TabsList>
						</Tabs>
						<Button
							size="default"
							className="ml-auto"
							onClick={async () => {
								await navigator.clipboard.writeText(prompts[prompt]);
								toast.success("Copied prompt");
							}}
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
		</section>
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
