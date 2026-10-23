import { parseTotp, totpCode, totpSecondsLeft } from "@mima/crypto";
import { Button } from "@mima/ui/components/button";
import { Input } from "@mima/ui/components/input";
import { cn } from "@mima/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	ArrowsClockwiseIcon,
	CaretDownIcon,
	ClockCountdownIcon,
	CopyIcon,
	FloppyDiskIcon,
	GlobeIcon,
	KeyIcon,
	LockSimpleIcon,
	MagnifyingGlassIcon,
	NoteIcon,
	TerminalWindowIcon,
	UserIcon,
} from "@phosphor-icons/react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import {
	dropCapture,
	getCapture,
	type Offer,
	offerFor,
	suggestedName,
} from "@/lib/capture";
import { fillLoginForm } from "@/lib/fill";
import {
	type Connection,
	forgetConnection,
	getConnection,
	getUnlocked,
	lock,
	saveConnection,
	saveUnlocked,
	touch,
	type Unlocked,
} from "@/lib/storage";
import {
	apiClient,
	type EditableEntry,
	type Entry,
	findServer,
	hostOf,
	loadVault,
	matchesPage,
	saveLogin,
	unlock,
	updatePassword,
	type VaultInfo,
	WrongPasswordError,
} from "@/lib/vault";

type Screen =
	| { name: "loading" }
	| { name: "connect" }
	| { name: "sign-in" }
	| { name: "unlock" }
	| { name: "items"; unlocked: Unlocked };

export default function App() {
	const [screen, setScreen] = useState<Screen>({ name: "loading" });
	const [connection, setConnection] = useState<Partial<Connection>>({});

	const route = async () => {
		const saved = await getConnection();
		setConnection(saved);
		if (!saved.server) return setScreen({ name: "connect" });
		if (!saved.email) return setScreen({ name: "sign-in" });
		const unlocked = await getUnlocked();
		if (!unlocked || !saved.token) return setScreen({ name: "unlock" });
		await touch();
		setScreen({ name: "items", unlocked });
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the popup opens
	useEffect(() => {
		void route();
	}, []);

	switch (screen.name) {
		case "loading":
			return <div className="h-40" />;
		case "connect":
			return <Connect onConnected={route} />;
		case "sign-in":
		case "unlock":
			return (
				<SignIn
					connection={connection}
					known={screen.name === "unlock"}
					onUnlocked={route}
					onOtherAccount={async () => {
						await lock();
						await saveConnection({ email: "", token: "" });
						await route();
					}}
					onOtherServer={async () => {
						await forgetConnection();
						await route();
					}}
				/>
			);
		case "items":
			return (
				<Items
					connection={connection as Connection}
					unlocked={screen.unlocked}
					onLock={async () => {
						await lock();
						await route();
					}}
				/>
			);
	}
}

function Connect({ onConnected }: { onConnected: () => void }) {
	const [address, setAddress] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		try {
			const found = await findServer(address);
			await saveConnection(found);
			onConnected();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card
			title="Connect to mima"
			description="Enter the address you open mima at in your browser."
		>
			<form onSubmit={submit} className="flex flex-col gap-3">
				<Field label="mima address">
					<Input
						autoFocus
						required
						placeholder="mima.example.com"
						value={address}
						onChange={(event) => setAddress(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<Button type="submit" variant="brand" disabled={busy}>
					{busy ? "Connecting…" : "Continue"}
				</Button>
			</form>
		</Card>
	);
}

function SignIn({
	connection,
	known,
	onUnlocked,
	onOtherAccount,
	onOtherServer,
}: {
	connection: Partial<Connection>;
	known: boolean;
	onUnlocked: () => void;
	onOtherAccount: () => void;
	onOtherServer: () => void;
}) {
	const [email, setEmail] = useState(connection.email ?? "");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		try {
			const result = await unlock(
				{
					server: connection.server as string,
					email: email.trim(),
					token: connection.token || undefined,
				},
				password,
			);
			await saveConnection({ email: email.trim(), token: result.token });
			await saveUnlocked(result.privateKey, result.publicKey);
			onUnlocked();
		} catch (err) {
			setPassword("");
			setError(
				err instanceof WrongPasswordError
					? "That email and master password don't match."
					: (err as Error).message,
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Card
			title={known ? "Unlock mima" : "Sign in to mima"}
			description={known ? connection.email : hostOf(connection.web)}
		>
			<form onSubmit={submit} className="flex flex-col gap-3">
				{!known && (
					<Field label="Email">
						<Input
							type="email"
							required
							autoFocus
							autoComplete="username"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
						/>
					</Field>
				)}
				<Field label="Master password">
					<Input
						type="password"
						required
						autoFocus={known}
						autoComplete="current-password"
						className="font-mono"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<Button type="submit" variant="brand" disabled={busy}>
					{busy ? "Unlocking…" : known ? "Unlock" : "Sign in"}
				</Button>
			</form>
			<div className="text-caption text-fg-muted mt-4 flex justify-center gap-3">
				{known ? (
					<LinkButton onClick={onOtherAccount}>Use another account</LinkButton>
				) : (
					<LinkButton onClick={onOtherServer}>Use another mima</LinkButton>
				)}
			</div>
		</Card>
	);
}

function Items({
	connection,
	unlocked,
	onLock,
}: {
	connection: Connection;
	unlocked: Unlocked;
	onLock: () => void;
}) {
	const [entries, setEntries] = useState<Entry[] | null>(null);
	const [vaults, setVaults] = useState<VaultInfo[]>([]);
	const [offer, setOffer] = useState<Offer | null>(null);
	const [error, setError] = useState("");
	const [query, setQuery] = useState("");
	const [tab, setTab] = useState<{ id?: number; url?: string }>({});
	const [status, setStatus] = useState("");
	const client = apiClient(connection.server, connection.token);

	const load = async (tabId?: number) => {
		try {
			const loaded = await loadVault(client, unlocked);
			setEntries(loaded.entries);
			setVaults(loaded.vaults);
			const capture = tabId === undefined ? null : await getCapture(tabId);
			const next = capture && offerFor(capture, loaded.entries);
			setOffer(next ?? null);
			if (capture && !next && tabId !== undefined) await dropCapture(tabId);
		} catch {
			setError("Couldn't load your items. Lock and unlock to try again.");
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: loads once per unlock
	useEffect(() => {
		(async () => {
			const target = await targetTab();
			setTab(target);
			await load(target.id);
		})();
	}, [unlocked]);

	const settle = async (message?: string) => {
		if (tab.id !== undefined) await dropCapture(tab.id);
		setOffer(null);
		if (message) {
			flash(message);
			await load();
		}
	};

	const host = hostOf(tab.url);
	const here = (entries ?? []).filter((entry) => matchesPage(entry, tab.url));
	const q = query.trim().toLowerCase();
	const results = q
		? (entries ?? []).filter(
				(entry) =>
					entry.name.toLowerCase().includes(q) ||
					entry.username?.toLowerCase().includes(q) ||
					entry.url?.toLowerCase().includes(q),
			)
		: null;

	const flash = (message: string) => {
		setStatus(message);
		setTimeout(() => setStatus(""), 2000);
	};

	const copy = async (entry: Entry, field: Field) => {
		await touch();
		if (field === "code") {
			const code = await oneTimeCode(entry);
			if (!code) return;
			await navigator.clipboard.writeText(code.value);
			flash(`One-time code copied · ${code.secondsLeft}s left`);
			void client.items
				.log({ id: entry.id, action: "copied", field: "one-time code" })
				.catch(() => {});
			return;
		}
		const value = entry[field];
		if (!value) return;
		await navigator.clipboard.writeText(value);
		flash(field === "secret" ? "Password copied" : "Username copied");
		if (field === "secret") {
			void client.items
				.log({ id: entry.id, action: "copied", field: "secret" })
				.catch(() => {});
		}
	};

	const fill = async (entry: Entry) => {
		if (tab.id === undefined) return;
		// The next page usually asks for the one-time code: copy it now, while the click
		// still counts as the person's action, so it's ready to paste.
		const code = await oneTimeCode(entry);
		if (code) await navigator.clipboard.writeText(code.value).catch(() => {});
		await touch();
		const [result] = await browser.scripting.executeScript({
			target: { tabId: tab.id },
			func: fillLoginForm,
			args: [entry.username ?? "", entry.secret ?? ""],
		});
		const filled = result?.result as { password: boolean } | undefined;
		if (!filled?.password) {
			flash("No password field on this page");
			return;
		}
		await client.items
			.log({ id: entry.id, action: "filled", field: "login" })
			.catch(() => {});
		window.close();
	};

	return (
		<div className="flex max-h-150 flex-col">
			<header className="border-line-subtle flex items-center gap-2 border-b px-3 py-2.5">
				<img src="/icon/32.png" alt="" className="size-5" />
				<span className="text-body-sm text-fg flex-1 font-medium">mima</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Open mima"
					title="Open mima"
					onClick={() => browser.tabs.create({ url: connection.web })}
				>
					<ArrowSquareOutIcon />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Lock"
					title="Lock"
					onClick={onLock}
				>
					<LockSimpleIcon />
				</Button>
			</header>

			{offer && (
				<SaveOffer
					offer={offer}
					vaults={vaults}
					onSave={async (vault, login) => {
						await touch();
						await saveLogin(client, vault, login);
						await settle(`Saved to ${vault.name}`);
					}}
					onUpdate={async (entry, password) => {
						await touch();
						const me = await client.account.me();
						await updatePassword(client, entry, password, me.name);
						await settle("Password updated");
					}}
					onDismiss={() => settle()}
				/>
			)}

			<div className="px-3 pt-3">
				<div className="relative">
					<MagnifyingGlassIcon className="text-fg-subtle absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
					<Input
						autoFocus
						aria-label="Search items"
						placeholder="Search items"
						className="pl-8"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-2 pb-3">
				{error && <p className="text-caption text-danger px-2 py-4">{error}</p>}
				{!entries && !error && (
					<p className="text-caption text-fg-subtle px-2 py-6 text-center">
						Decrypting…
					</p>
				)}
				{entries && results && (
					<Section label="Results">
						{results.length === 0 ? (
							<Empty>Nothing matches.</Empty>
						) : (
							results.map((entry) => (
								<Row
									key={entry.id}
									entry={entry}
									canFill={matchesPage(entry, tab.url)}
									onFill={fill}
									onCopy={copy}
								/>
							))
						)}
					</Section>
				)}
				{entries && !results && (
					<>
						{host && (
							<Section label={`On ${host}`}>
								{here.length === 0 ? (
									<Empty>Nothing saved for this site.</Empty>
								) : (
									here.map((entry) => (
										<Row
											key={entry.id}
											entry={entry}
											canFill
											onFill={fill}
											onCopy={copy}
										/>
									))
								)}
							</Section>
						)}
						<Section label="All items">
							{entries.length === 0 ? (
								<Empty>No items yet. Add them in mima.</Empty>
							) : (
								entries.map((entry) => (
									<Row
										key={entry.id}
										entry={entry}
										canFill={false}
										onFill={fill}
										onCopy={copy}
									/>
								))
							)}
						</Section>
					</>
				)}
			</div>

			<p
				role="status"
				className={cn(
					"bg-cta text-cta-fg text-caption pointer-events-none fixed inset-x-3 bottom-3 rounded-full px-3 py-2 text-center transition-opacity",
					status ? "opacity-100" : "opacity-0",
				)}
			>
				{status}
			</p>
		</div>
	);
}

const offerCard =
	"bg-surface shadow-card mx-3 mt-3 flex flex-col gap-3 rounded-xl p-3";

function OfferTitle({
	icon: Icon,
	title,
	children,
}: {
	icon: typeof FloppyDiskIcon;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex items-start gap-2.5">
			<span className="bg-brand-soft text-brand flex size-7 shrink-0 items-center justify-center rounded-md">
				<Icon className="size-4" />
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<h2 className="text-body-sm text-fg font-medium">{title}</h2>
				<p className="text-caption text-fg-muted">{children}</p>
			</div>
		</div>
	);
}

/** Offers to keep a login the person just typed into the page. */
function SaveOffer({
	offer,
	vaults,
	onSave,
	onUpdate,
	onDismiss,
}: {
	offer: Offer;
	vaults: VaultInfo[];
	onSave: (
		vault: VaultInfo,
		login: { name: string; username: string; password: string; url: string },
	) => Promise<void>;
	onUpdate: (entry: EditableEntry, password: string) => Promise<void>;
	onDismiss: () => void;
}) {
	const { capture } = offer;
	const [name, setName] = useState(() => suggestedName(capture.url));
	const [username, setUsername] = useState(capture.username);
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

	if (offer.kind === "update") {
		return (
			<section aria-label="Update password" className={offerCard}>
				<OfferTitle
					icon={ArrowsClockwiseIcon}
					title={`Update the password for ${offer.entry.name}?`}
				>
					You signed in as {capture.username || "this account"} with a new
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
						onClick={() => run(() => onUpdate(offer.entry, capture.password))}
					>
						{busy ? "Encrypting…" : "Update"}
					</Button>
				</div>
			</section>
		);
	}

	return (
		<section aria-label="Save login" className={offerCard}>
			<OfferTitle icon={FloppyDiskIcon} title="Save this login to mima?">
				You just signed in on {hostOf(capture.url)}.
			</OfferTitle>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Name">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</Field>
				<Field label="Vault">
					<span className="relative flex">
						<select
							value={vaultId}
							onChange={(event) => setVaultId(event.target.value)}
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
					onClick={() => {
						const vault = vaults.find((v) => v.id === vaultId);
						if (!vault) return;
						void run(() =>
							onSave(vault, {
								name: name.trim(),
								username: username.trim(),
								password: capture.password,
								url: capture.url,
							}),
						);
					}}
				>
					{busy ? "Encrypting…" : "Save"}
				</Button>
			</div>
		</section>
	);
}

type Field = "username" | "secret" | "code";

async function oneTimeCode(entry: Entry) {
	const config = entry.totp ? parseTotp(entry.totp) : null;
	if (!config) return null;
	try {
		return {
			value: await totpCode(config),
			secondsLeft: totpSecondsLeft(config),
		};
	} catch {
		return null;
	}
}

const kindIcon = {
	login: GlobeIcon,
	"api-key": KeyIcon,
	note: NoteIcon,
	"ssh-key": TerminalWindowIcon,
};

function Row({
	entry,
	canFill,
	onFill,
	onCopy,
}: {
	entry: Entry;
	canFill: boolean;
	onFill: (entry: Entry) => void;
	onCopy: (entry: Entry, field: Field) => void;
}) {
	const Icon = kindIcon[entry.kind];
	return (
		<li className="hover:bg-tint/4 flex items-center gap-2.5 rounded-lg px-2 py-1.5">
			<span className="bg-surface text-fg-muted shadow-pill flex size-7 shrink-0 items-center justify-center rounded-md">
				<Icon className="size-4" />
			</span>
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="text-body-sm text-fg truncate">{entry.name}</span>
				<span className="text-caption text-fg-subtle truncate">
					{entry.username || hostOf(entry.url) || entry.vault}
				</span>
			</div>
			{entry.username && (
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Copy username for ${entry.name}`}
					title="Copy username"
					onClick={() => onCopy(entry, "username")}
				>
					<UserIcon />
				</Button>
			)}
			{entry.secret && (
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Copy password for ${entry.name}`}
					title="Copy password"
					onClick={() => onCopy(entry, "secret")}
				>
					<CopyIcon />
				</Button>
			)}
			{entry.totp && (
				<Button
					variant="ghost"
					size="icon-xs"
					aria-label={`Copy one-time code for ${entry.name}`}
					title="Copy one-time code"
					onClick={() => onCopy(entry, "code")}
				>
					<ClockCountdownIcon />
				</Button>
			)}
			{canFill && entry.kind === "login" && entry.secret && (
				<Button
					variant="brand"
					size="xs"
					aria-label={`Fill ${entry.name}`}
					onClick={() => onFill(entry)}
				>
					Fill
				</Button>
			)}
		</li>
	);
}

function Section({ label, children }: { label: string; children: ReactNode }) {
	return (
		<section className="mt-1">
			<h2 className="text-micro text-fg-subtle px-2 pt-2 pb-1 font-medium">
				{label}
			</h2>
			<ul aria-label={label} className="flex flex-col">
				{children}
			</ul>
		</section>
	);
}

function Empty({ children }: { children: ReactNode }) {
	return <li className="text-caption text-fg-subtle px-2 py-2">{children}</li>;
}

function Card({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<main className="flex flex-col p-5">
			<div className="mb-5 flex flex-col items-center gap-2 text-center">
				<img src="/icon/48.png" alt="" className="size-9" />
				<h1 className="text-body text-fg font-medium">{title}</h1>
				{description && (
					<p className="text-caption text-fg-muted">{description}</p>
				)}
			</div>
			{children}
		</main>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
		<label className="flex flex-col gap-1.5">
			<span className="text-caption text-fg-muted">{label}</span>
			{children}
		</label>
	);
}

function FormError({ children }: { children: ReactNode }) {
	if (!children) return null;
	return (
		<p
			role="alert"
			className="border-danger-line bg-danger-soft text-caption text-danger-strong rounded-lg border px-3 py-2"
		>
			{children}
		</p>
	);
}

function LinkButton({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="hover:text-fg underline-offset-4 hover:underline"
		>
			{children}
		</button>
	);
}

/**
 * The tab to fill: the active tab, or the one named in ?tab= when the popup is opened
 * as a page of its own (as the tests do).
 */
async function targetTab(): Promise<{ id?: number; url?: string }> {
	const named = Number(new URLSearchParams(location.search).get("tab"));
	if (named) {
		const tab = await browser.tabs.get(named);
		return { id: tab.id, url: tab.url };
	}
	const [active] = await browser.tabs.query({
		active: true,
		currentWindow: true,
	});
	return { id: active?.id, url: active?.url };
}
