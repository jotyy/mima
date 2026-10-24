import {
	ArrowSquareOutIcon,
	ClockIcon,
	LinkBreakIcon,
	LockSimpleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { keyFromText, openJson } from "@vauly/crypto";
import { Button } from "@vauly/ui/components/button";
import { type ReactNode, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { CardFields, Field, IdentityFields } from "@/components/detail-fields";
import { ItemTile } from "@/components/item-tile";
import Loader from "@/components/loader";
import { OneTimeCode } from "@/components/one-time-code";
import { SecretValue } from "@/components/secret-value";
import { VaulyLogo } from "@/components/vauly-mark";
import { timeLeft } from "@/lib/format";
import { logoDomain } from "@/lib/logos";
import { type SharedItem, websitesOf } from "@/lib/vault-data";
import { client } from "@/utils/orpc";

// The page someone outside the workspace lands on from a share link. The key is in the
// #fragment, which browsers never send to a server; the item is decrypted right here.

export const Route = createFileRoute("/s/$id")({
	component: SharedItemPage,
	head: () => ({
		meta: [
			{ title: "A shared item · vauly" },
			{ name: "robots", content: "noindex" },
		],
	}),
});

function SharedItemPage() {
	const { id } = Route.useParams();
	const [key] = useState(() => window.location.hash.slice(1));
	const [item, setItem] = useState<SharedItem | null>(null);
	const [problem, setProblem] = useState<"gone" | "broken" | null>(null);
	const [busy, setBusy] = useState(false);
	const peek = useQuery({
		queryKey: ["share", id],
		queryFn: () => client.links.peek({ id }),
		enabled: !item,
		retry: false,
		refetchOnWindowFocus: false,
	});

	const show = async () => {
		setBusy(true);
		const cryptoKey = await keyFromText(key).catch(() => null);
		const opened =
			cryptoKey && (await client.links.open({ id }).catch(() => null));
		const shared =
			cryptoKey &&
			opened &&
			(await openJson<SharedItem>(cryptoKey, opened.data).catch(() => null));
		setBusy(false);
		if (shared) setItem(shared);
		else setProblem(cryptoKey && !opened ? "gone" : "broken");
	};

	let content: ReactNode;
	if (item) {
		content = <Opened item={item} />;
	} else if (peek.isPending) {
		content = <Loader />;
	} else if (peek.isError || problem === "gone") {
		content = (
			<Notice
				icon={<LinkBreakIcon className="size-5" />}
				title="This link doesn't work anymore"
			>
				It expired, it was already opened, or the person who sent it turned it
				off. Ask them for a new one.
			</Notice>
		);
	} else if (!key || problem === "broken") {
		content = (
			<Notice
				icon={<LinkBreakIcon className="size-5" />}
				title="This link is missing its key"
			>
				The end of the link, after the #, unlocks the item. Copy the whole link
				and open it again.
			</Notice>
		);
	} else {
		const once = peek.data.viewsLeft === 1;
		content = (
			<section className="rounded-window bg-surface shadow-card flex flex-col items-center gap-4 px-6 py-8 text-center">
				<span className="bg-surface-sunken text-fg-muted flex size-11 items-center justify-center rounded-full">
					<LockSimpleIcon className="size-5" />
				</span>
				<div className="flex flex-col gap-1.5">
					<h1 className="text-h5 text-fg text-balance">
						{peek.data.sharedBy} shared an item with you
					</h1>
					<p className="text-body-sm text-fg-muted">
						From {peek.data.workspace}. It's encrypted until you open it here.
					</p>
				</div>
				<Button variant="brand" disabled={busy} onClick={show}>
					{busy ? "Opening…" : "Show the item"}
				</Button>
				<p className="text-caption text-fg-subtle flex items-center gap-1.5">
					<ClockIcon className="size-3.5" />
					{once
						? `Opens only once, so copy what you need. Expires ${timeLeft(peek.data.expiresAt)}.`
						: `The link expires ${timeLeft(peek.data.expiresAt)}.`}
				</p>
			</section>
		);
	}

	return (
		<div className="bg-frame flex min-h-svh flex-col items-center px-4 py-12 sm:py-20">
			<VaulyLogo className="mb-8" />
			<main className="w-full max-w-md">{content}</main>
			<p className="text-caption text-fg-subtle mt-6 max-w-md text-center text-balance">
				Shared with vauly. The item was encrypted before it left the sender's
				device and is decrypted only in this browser.
			</p>
		</div>
	);
}

function Notice({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-window bg-surface shadow-card flex flex-col items-center gap-3 px-6 py-8 text-center">
			<span className="bg-surface-sunken text-fg-muted flex size-11 items-center justify-center rounded-full">
				{icon}
			</span>
			<h1 className="text-h5 text-fg">{title}</h1>
			<p className="text-body-sm text-fg-muted text-balance">{children}</p>
		</section>
	);
}

function Opened({ item }: { item: SharedItem }) {
	return (
		<section
			aria-label={item.name}
			className="rounded-window bg-surface shadow-card flex flex-col"
		>
			<header className="border-line-subtle flex items-center gap-3 border-b p-4">
				<ItemTile kind={item.kind} size="lg" logo={logoDomain(item)} />
				<h1 className="text-h5 text-fg min-w-0 truncate">{item.name}</h1>
			</header>
			<dl className="divide-line-subtle flex flex-col divide-y px-4">
				{item.username && (
					<Field label="Username">
						<span className="text-body-sm text-fg min-w-0 flex-1 truncate">
							{item.username}
						</span>
						<CopyButton value={item.username} label="username" secret={false} />
					</Field>
				)}
				{item.secret && (
					<Field label={item.kind === "login" ? "Password" : "Value"}>
						<SecretValue
							value={item.secret}
							label={item.kind === "login" ? "password" : "value"}
							source={item.name}
						/>
					</Field>
				)}
				{item.totp && (
					<Field label="One-time code">
						<OneTimeCode secret={item.totp} source={item.name} />
					</Field>
				)}
				{item.card && <CardFields card={item.card} source={item.name} />}
				{item.identity && (
					<IdentityFields identity={item.identity} source={item.name} />
				)}
				{websitesOf(item).map((url) => (
					<Field key={url} label="Website">
						<a
							href={url}
							target="_blank"
							rel="noreferrer"
							className="text-body-sm text-link flex min-w-0 items-center gap-1 hover:underline"
						>
							<span className="truncate">{url}</span>
							<ArrowSquareOutIcon className="size-3.5 shrink-0" />
						</a>
					</Field>
				))}
				{item.fields?.map((field) => (
					<Field key={`${field.label}:${field.value}`} label={field.label}>
						{field.hidden ? (
							<SecretValue
								value={field.value}
								label={field.label}
								source={item.name}
							/>
						) : (
							<>
								<span className="text-body-sm text-fg min-w-0 flex-1 break-words whitespace-pre-wrap">
									{field.value}
								</span>
								<CopyButton
									value={field.value}
									label={field.label}
									secret={false}
								/>
							</>
						)}
					</Field>
				))}
				{item.notes && (
					<Field label="Notes">
						<p className="text-body-sm text-fg py-1 leading-relaxed whitespace-pre-wrap">
							{item.notes}
						</p>
					</Field>
				)}
			</dl>
		</section>
	);
}
