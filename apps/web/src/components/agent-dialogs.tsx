import { WarningIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vauly/ui/components/dialog";
import { Input } from "@vauly/ui/components/input";
import { Tabs, TabsList, TabsTrigger } from "@vauly/ui/components/tabs";
import { useEffect, useState } from "react";

import { ENV } from "@/env.public";
import { errorMessage, useActions } from "@/lib/vault-data";

import { Field } from "./auth-layout";
import { CopyButton } from "./copy-button";
import { notify } from "./notify";

const kinds = [
	{ value: "mcp", label: "Coding agent" },
	{ value: "cli", label: "Script or server" },
	{ value: "ci", label: "CI job" },
] as const;

const expiries = [
	{ value: "7", label: "7 days" },
	{ value: "30", label: "30 days" },
	{ value: "never", label: "No expiry" },
];

export const serverUrl = () => ENV.VITE_SERVER_URL.replace(/\/$/, "");

export function NewAgentDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const actions = useActions();
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"mcp" | "cli" | "ci">("mcp");
	const [expiry, setExpiry] = useState("7");
	const [token, setToken] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (open) {
			setName("");
			setKind("mcp");
			setExpiry("7");
			setToken(null);
		}
	}, [open]);

	const env = token ? `VAULY_SERVER=${serverUrl()}\nVAULY_TOKEN=${token}` : "";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{token ? (
					<>
						<DialogHeader>
							<DialogTitle>{name} is ready</DialogTitle>
							<DialogDescription>
								Put these two lines in the agent's environment. The token holds
								the agent's private key, so it is shown only now.
							</DialogDescription>
						</DialogHeader>
						<div className="border-line bg-surface-sunken flex items-start gap-1 rounded-lg border py-2 pr-1 pl-3">
							<pre
								data-testid="agent-env"
								className="text-caption text-fg min-w-0 flex-1 font-mono break-all whitespace-pre-wrap"
							>
								{env}
							</pre>
							<CopyButton value={env} label="agent settings" />
						</div>
						<div className="border-warning-line bg-warning-soft text-caption text-warning flex gap-2 rounded-lg border px-3 py-2.5">
							<WarningIcon className="mt-px size-4 shrink-0" />
							Keep it out of the repository. If it leaks, pause or delete the
							agent here.
						</div>
						<DialogFooter>
							<Button onClick={() => onOpenChange(false)}>
								I've stored it
							</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>New agent</DialogTitle>
							<DialogDescription>
								An agent can run commands with your secrets without seeing them.
								It can use an item only after you approve it.
							</DialogDescription>
						</DialogHeader>
						<form
							className="flex flex-col gap-3.5"
							onSubmit={async (event) => {
								event.preventDefault();
								if (!name.trim()) return;
								setBusy(true);
								try {
									const created = await actions.createAgent({
										name: name.trim(),
										kind,
										expiresInDays: expiry === "never" ? null : Number(expiry),
									});
									setToken(created.token);
								} catch (err) {
									notify.error("Couldn't create the agent", errorMessage(err));
								} finally {
									setBusy(false);
								}
							}}
						>
							<Field label="Name">
								<Input
									autoFocus
									required
									placeholder="Claude Code on my laptop"
									value={name}
									onChange={(event) => setName(event.target.value)}
								/>
							</Field>
							<div className="flex flex-col gap-1.5">
								<span className="text-caption text-fg-muted">What it is</span>
								<Tabs
									value={kind}
									onValueChange={(value) => setKind(value as typeof kind)}
								>
									<TabsList>
										{kinds.map((k) => (
											<TabsTrigger key={k.value} value={k.value}>
												{k.label}
											</TabsTrigger>
										))}
									</TabsList>
								</Tabs>
							</div>
							<div className="flex flex-col gap-1.5">
								<span className="text-caption text-fg-muted">
									Token expires after
								</span>
								<Tabs
									value={expiry}
									onValueChange={(value) => setExpiry(String(value))}
								>
									<TabsList>
										{expiries.map((e) => (
											<TabsTrigger key={e.value} value={e.value}>
												{e.label}
											</TabsTrigger>
										))}
									</TabsList>
								</Tabs>
							</div>
							<DialogFooter>
								<Button
									type="button"
									variant="ghost"
									onClick={() => onOpenChange(false)}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={busy || !name.trim()}>
									{busy ? "Creating keys…" : "Create agent"}
								</Button>
							</DialogFooter>
						</form>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
