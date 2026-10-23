import {
	ArrowsClockwiseIcon,
	CaretDownIcon,
	FloppyDiskIcon,
} from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { Input } from "@vauly/ui/components/input";
import { cn } from "@vauly/ui/lib/utils";
import { type ReactNode, useState } from "react";

import type { OfferView } from "@/lib/messages";

import { Field, FormError } from "./form";

/**
 * Offers to keep a login the person just typed into a site, in the popup and on the
 * page itself. It never sees the password: saving hands back only what was edited.
 */
export function SaveOffer({
	offer,
	vaults,
	onSave,
	onUpdate,
	onDismiss,
	onPage = false,
	className,
}: {
	offer: OfferView;
	vaults: { id: string; name: string }[];
	onSave: (
		vaultId: string,
		login: { name: string; username: string },
	) => Promise<void>;
	onUpdate: () => Promise<void>;
	onDismiss: () => void;
	/** On a site's page, the card shows vauly's mark so it's clear who's asking. */
	onPage?: boolean;
	className?: string;
}) {
	const [name, setName] = useState(offer.host || "New login");
	const [username, setUsername] = useState(offer.username);
	const [vaultId, setVaultId] = useState(vaults[0]?.id ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const run = async (work: () => Promise<void>) => {
		setBusy(true);
		setError("");
		try {
			await work();
		} catch (err) {
			setError((err as Error).message || "That didn't work");
			setBusy(false);
		}
	};

	const card = cn("bg-surface flex flex-col gap-3 rounded-xl p-3", className);

	if (offer.kind === "update") {
		return (
			<section aria-label="Update password" className={card}>
				<OfferTitle
					icon={ArrowsClockwiseIcon}
					onPage={onPage}
					title={`Update the password for ${offer.entryName}?`}
				>
					You signed in as {offer.username || "this account"} with a new
					password. The old one stays under Earlier passwords.
				</OfferTitle>
				<FormError>{error}</FormError>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" size="sm" onClick={onDismiss}>
						Not now
					</Button>
					<Button
						variant="brand"
						size="sm"
						disabled={busy}
						onClick={() => run(onUpdate)}
					>
						{busy ? "Encrypting…" : "Update"}
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section aria-label="Save login" className={card}>
			<OfferTitle
				icon={FloppyDiskIcon}
				onPage={onPage}
				title="Save this login to vauly?"
			>
				You just signed in on {offer.host}.
			</OfferTitle>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Field label="Vault">
					<VaultSelect vaults={vaults} value={vaultId} onChange={setVaultId} />
				</Field>
				<div className="col-span-2">
					<Field label="Username">
						<Input
							value={username}
							onChange={(event) => setUsername(event.target.value)}
						/>
					</Field>
				</div>
			</div>
			<FormError>{error}</FormError>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onDismiss}>
					Not now
				</Button>
				<Button
					variant="brand"
					size="sm"
					disabled={busy || !name.trim() || !vaultId}
					onClick={() =>
						run(() =>
							onSave(vaultId, { name: name.trim(), username: username.trim() }),
						)
					}
				>
					{busy ? "Encrypting…" : "Save"}
				</Button>
			</div>
		</section>
	);
}

/** The vaults this person can add to, for a new login or passkey. */
export function VaultSelect({
	vaults,
	value,
	onChange,
}: {
	vaults: { id: string; name: string }[];
	value: string;
	onChange: (id: string) => void;
}) {
	return (
		<span className="relative flex">
			<select
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="border-line bg-surface text-body-sm text-fg focus-visible:border-brand h-8 w-full appearance-none rounded-lg border pr-7 pl-2.5 outline-none"
			>
				{vaults.map((vault) => (
					<option key={vault.id} value={vault.id}>
						{vault.name}
					</option>
				))}
			</select>
			<CaretDownIcon className="text-fg-subtle pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2" />
		</span>
	);
}

function OfferTitle({
	icon: Icon,
	onPage,
	title,
	children,
}: {
	icon: typeof FloppyDiskIcon;
	onPage: boolean;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5">
			{onPage ? (
				<img src="/icon/32.png" alt="vauly" className="size-7 shrink-0" />
			) : (
				<span className="bg-brand-soft text-brand flex size-7 shrink-0 items-center justify-center rounded-md">
					<Icon className="size-4" />
				</span>
			)}
			<div className="flex min-w-0 flex-col gap-0.5">
				<h2 className="text-body-sm text-fg font-medium">{title}</h2>
				<p className="text-caption text-fg-muted">{children}</p>
			</div>
		</div>
	);
}
