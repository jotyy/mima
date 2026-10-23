import { Button } from "@mima/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mima/ui/components/dialog";
import { Switch } from "@mima/ui/components/switch";
import { Tabs, TabsList, TabsTrigger } from "@mima/ui/components/tabs";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useState } from "react";

import {
	errorMessage,
	type Item,
	type LinkDuration,
	useActions,
} from "@/lib/vault-data";

import { CopyButton } from "./copy-button";
import { notify } from "./notify";

const durations: { value: LinkDuration; label: string }[] = [
	{ value: "hour", label: "1 hour" },
	{ value: "day", label: "1 day" },
	{ value: "week", label: "7 days" },
	{ value: "month", label: "30 days" },
];

/** Shares one item with someone outside the workspace through a link that expires. */
export function ShareLinkDialog({
	item,
	open,
	onOpenChange,
}: {
	item: Item;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const actions = useActions();
	const [expiresIn, setExpiresIn] = useState<LinkDuration>("day");
	const [once, setOnce] = useState(false);
	const [totp, setTotp] = useState(false);
	const [busy, setBusy] = useState(false);
	const [created, setCreated] = useState<{
		url: string;
		expiresAt: Date;
		once: boolean;
	} | null>(null);

	useEffect(() => {
		if (open) {
			setCreated(null);
			setExpiresIn("day");
			setOnce(false);
			setTotp(false);
		}
	}, [open]);

	const shown = [
		item.username && "username",
		item.secret && (item.kind === "login" ? "password" : "value"),
		item.url && "website",
		item.notes && "notes",
		totp && "one-time code",
	];

	const create = async () => {
		setBusy(true);
		try {
			const link = await actions.createLink(item, { expiresIn, once, totp });
			setCreated({ ...link, expiresAt: new Date(link.expiresAt), once });
		} catch (err) {
			notify.error("Couldn't create the link", errorMessage(err));
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				{created ? (
					<>
						<DialogHeader>
							<DialogTitle>Your link is ready</DialogTitle>
							<DialogDescription>
								Copy it now. mima can't show it again: the key at the end of the
								link is never saved anywhere.
							</DialogDescription>
						</DialogHeader>
						<div className="border-line bg-surface-sunken flex items-center gap-1 rounded-lg border py-1 pr-1 pl-3">
							<code
								data-testid="share-link"
								className="text-caption text-fg min-w-0 flex-1 truncate font-mono"
							>
								{created.url}
							</code>
							<CopyButton value={created.url} label="link" source={item.name} />
						</div>
						<p className="text-caption text-fg-subtle">
							{created.once ? "Works once, until " : "Works until "}
							{created.expiresAt.toLocaleString(undefined, {
								dateStyle: "medium",
								timeStyle: "short",
							})}
							. You can turn it off from the item at any time.
						</p>
						<DialogFooter>
							<Button onClick={() => onOpenChange(false)}>Done</Button>
						</DialogFooter>
					</>
				) : (
					<>
						<DialogHeader>
							<DialogTitle>Share {item.name} by link</DialogTitle>
							<DialogDescription>
								For someone outside the workspace. They don't need an account,
								and the link stops working when it expires.
							</DialogDescription>
						</DialogHeader>

						<div className="flex flex-col gap-1.5">
							<span className="text-body-sm text-fg">Expires after</span>
							<Tabs
								value={expiresIn}
								onValueChange={(value) => setExpiresIn(value as LinkDuration)}
							>
								<TabsList>
									{durations.map((d) => (
										<TabsTrigger key={d.value} value={d.value}>
											{d.label}
										</TabsTrigger>
									))}
								</TabsList>
							</Tabs>
						</div>

						<div className="divide-line-subtle flex flex-col divide-y">
							<Toggle
								label="Only one view"
								hint="The link stops working once it's opened."
								checked={once}
								onChange={setOnce}
							/>
							{item.totp && (
								<Toggle
									label="Include the one-time code"
									hint="Only if they need to sign in on their own."
									checked={totp}
									onChange={setTotp}
								/>
							)}
						</div>

						<p className="text-caption text-fg-muted bg-surface-sunken flex gap-2 rounded-lg px-3 py-2.5">
							<LockSimpleIcon className="mt-0.5 size-3.5 shrink-0" />
							<span>
								The link shows the {listOf(shown)} as they are now. It's
								encrypted on this device, and the key travels only in the link,
								so mima's server can't read it.
							</span>
						</p>

						<DialogFooter>
							<Button variant="ghost" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button disabled={busy} onClick={create}>
								{busy ? "Encrypting…" : "Create link"}
							</Button>
						</DialogFooter>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function Toggle({
	label,
	hint,
	checked,
	onChange,
}: {
	label: string;
	hint: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the switch inside is the control
		<label className="flex items-center gap-3 py-2.5">
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="text-body-sm text-fg">{label}</span>
				<span className="text-caption text-fg-muted">{hint}</span>
			</span>
			<Switch checked={checked} onCheckedChange={onChange} />
		</label>
	);
}

/** "username, password and notes" */
function listOf(parts: (string | false | undefined)[]) {
	const words = parts.filter((part): part is string => Boolean(part));
	if (words.length <= 1) return words[0] ?? "item";
	return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
