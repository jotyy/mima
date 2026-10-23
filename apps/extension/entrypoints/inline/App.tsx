import { CheckCircleIcon, GlobeIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { Field, FormError } from "@/components/form";
import { ItemLogo } from "@/components/item-logo";
import { SaveOffer, VaultSelect } from "@/components/save-offer";
import {
	ask,
	type Done,
	type FillResult,
	type FrameRequest,
	type MenuLogin,
	type MenuState,
	type OfferState,
	type PasskeyState,
} from "@/lib/messages";

// vauly's frame inside a site's page. The page script decides where it goes; what it
// shows comes from the background, which knows the tab it's in.

const view = location.hash.slice(1);

export function tellPage(
	message: { vauly: "size"; height: number } | { vauly: "close" },
) {
	window.parent.postMessage(message, "*");
}

const close = () => tellPage({ vauly: "close" });

export default function App() {
	if (view === "save") return <Save />;
	if (view === "passkey") return <Passkey />;
	return <Menu />;
}

/**
 * Runs again when the extension locks or unlocks, or a waiting login or passkey request
 * comes or goes.
 */
function useSessionChange(load: () => void) {
	useEffect(() => {
		const changed = (
			changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
			area: string,
		) => {
			if (area !== "session") return;
			const unlocked = changes.unlocked;
			if (
				(unlocked && !unlocked.oldValue !== !unlocked.newValue) ||
				Object.keys(changes).some(
					(key) => key.startsWith("capture:") || key.startsWith("passkey:"),
				)
			)
				load();
		};
		browser.storage.onChanged.addListener(changed);
		return () => browser.storage.onChanged.removeListener(changed);
	}, [load]);
}

/** The popup is where people sign in and unlock; open it from the page if we can. */
async function openPopup(): Promise<boolean> {
	try {
		await browser.action.openPopup();
		return true;
	} catch {
		return false;
	}
}

function Card({ children }: { children: ReactNode }) {
	return (
		<div className="bg-surface shadow-popover overflow-hidden rounded-xl">
			{children}
		</div>
	);
}

function Note({ children }: { children: ReactNode }) {
	return (
		<p
			role="status"
			className="border-line-subtle text-caption text-fg-muted border-t px-3 py-2"
		>
			{children}
		</p>
	);
}

// ── The fill menu, under a login field ──────────────────────────────────────────────

function Menu() {
	const [state, setState] = useState<MenuState | null>(null);
	const [note, setNote] = useState("");
	const load = useCallback(() => {
		void ask<MenuState>({ type: "vauly:menu" }).then(setState);
	}, []);
	useEffect(load, [load]);
	useSessionChange(load);

	if (!state) return null;

	if (state.status !== "ready") {
		const locked = state.status === "locked";
		return (
			<Card>
				<div className="flex items-center gap-3 p-3">
					<img src="/icon/32.png" alt="" className="size-7 shrink-0" />
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="text-body-sm text-fg font-medium">
							{locked ? "vauly is locked" : "Sign in to vauly"}
						</span>
						<span className="text-caption text-fg-subtle">
							{locked
								? "Unlock it to fill your logins here."
								: "Connect the extension to fill your logins."}
						</span>
					</div>
					<Button
						variant="brand"
						size="sm"
						onClick={async () => {
							if (!(await openPopup()))
								setNote(
									"Click vauly among your browser's extensions to continue.",
								);
						}}
					>
						{locked ? "Unlock" : "Sign in"}
					</Button>
				</div>
				{note && <Note>{note}</Note>}
			</Card>
		);
	}

	const fill = async (login: MenuLogin) => {
		const result = await ask<FillResult>({ type: "vauly:fill", id: login.id });
		if (!result?.ok) {
			setNote("There's no password field to fill on this page.");
			return;
		}
		if (result.code) {
			// The next step usually asks for it.
			await navigator.clipboard.writeText(result.code).catch(() => {});
			setNote("Filled. The one-time code is copied for the next step.");
			setTimeout(close, 1800);
			return;
		}
		close();
	};

	return (
		<Card>
			{state.logins.length === 0 ? (
				<p className="text-caption text-fg-subtle px-3 py-3">
					Nothing saved for {state.host} yet. Sign in, and vauly offers to keep
					the login.
				</p>
			) : (
				<ul
					aria-label={`Logins for ${state.host}`}
					className="flex max-h-72 flex-col overflow-y-auto p-1"
				>
					{state.logins.map((login) => (
						<li key={login.id}>
							<button
								type="button"
								aria-label={`Fill ${login.name}${login.username ? `, ${login.username}` : ""}`}
								onClick={() => fill(login)}
								className="group/row hover:bg-tint/4 focus-visible:bg-tint/4 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none"
							>
								<ItemLogo logo={login.logo} icon={GlobeIcon} />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-body-sm text-fg truncate">
										{login.name}
									</span>
									<span className="text-caption text-fg-subtle truncate">
										{login.username || "No username"}
									</span>
								</span>
								<span className="text-caption text-brand opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
									Fill
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
			{note ? (
				<Note>{note}</Note>
			) : (
				<div className="border-line-subtle text-micro text-fg-subtle flex items-center gap-1.5 border-t px-3 py-2">
					<img src="/icon/16.png" alt="" className="size-3.5" />
					vauly
				</div>
			)}
		</Card>
	);
}

// ── The save prompt, in the top corner ──────────────────────────────────────────────

function Save() {
	const [state, setState] = useState<OfferState | null>(null);
	const [done, setDone] = useState("");
	const [note, setNote] = useState("");
	/** Saving from here clears the waiting login too; that mustn't close the frame early. */
	const saving = useRef(false);
	const load = useCallback(() => {
		void ask<OfferState>({ type: "vauly:offer" }).then((next) => {
			if (saving.current) return;
			// Saved or dismissed somewhere else, such as the popup.
			if (!next || next.status === "none") close();
			else setState(next);
		});
	}, []);
	useEffect(load, [load]);
	useSessionChange(load);

	const send = async (request: FrameRequest) => {
		saving.current = true;
		const result = await ask<Done>(request);
		if (!result?.ok) {
			saving.current = false;
			throw new Error(result?.error ?? "That didn't work");
		}
		setDone(result.message ?? "Done");
		setTimeout(close, 1500);
	};
	const dismiss = async () => {
		await ask<Done>({ type: "vauly:dismiss" });
		close();
	};

	if (done) {
		return (
			<Card>
				<p
					role="status"
					className="text-body-sm text-fg flex items-center gap-2 px-3 py-3"
				>
					<CheckCircleIcon weight="fill" className="text-success size-4" />
					{done}
				</p>
			</Card>
		);
	}
	if (!state || state.status === "none") return null;

	if (state.status === "locked") {
		return (
			<Card>
				<section aria-label="Save login" className="flex flex-col gap-3 p-3">
					<div className="flex items-start gap-2.5">
						<img src="/icon/32.png" alt="vauly" className="size-7 shrink-0" />
						<div className="flex min-w-0 flex-col gap-0.5">
							<h2 className="text-body-sm text-fg font-medium">
								Save this login to vauly?
							</h2>
							<p className="text-caption text-fg-muted">
								You just signed in on {state.host}. Unlock vauly to keep it; it
								waits for five minutes.
							</p>
						</div>
					</div>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" size="sm" onClick={dismiss}>
							Not now
						</Button>
						<Button
							variant="brand"
							size="sm"
							onClick={async () => {
								if (!(await openPopup()))
									setNote(
										"Click vauly among your browser's extensions to unlock.",
									);
							}}
						>
							Unlock
						</Button>
					</div>
				</section>
				{note && <Note>{note}</Note>}
			</Card>
		);
	}

	return (
		<SaveOffer
			key={`${state.offer.kind}:${state.offer.username}`}
			onPage
			offer={state.offer}
			vaults={state.vaults}
			className="shadow-popover"
			onSave={(vaultId, login) =>
				send({ type: "vauly:save", vaultId, ...login })
			}
			onUpdate={() => send({ type: "vauly:update" })}
			onDismiss={dismiss}
		/>
	);
}

// ── The passkey prompt, in the top corner ───────────────────────────────────────────

/**
 * Asks before vauly makes or uses a passkey for the site: choosing here is what counts as
 * the person being present and verified. Anything but a choice in vauly hands the
 * request back to the browser, or turns it down.
 */
function Passkey() {
	const [state, setState] = useState<PasskeyState | null>(null);
	const [vaultId, setVaultId] = useState("");
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState("");
	const [error, setError] = useState("");
	const [note, setNote] = useState("");
	/** Answering clears the waiting request too; that mustn't close the frame early. */
	const acting = useRef(false);
	const load = useCallback(() => {
		void ask<PasskeyState>({ type: "vauly:passkey-state" }).then((next) => {
			if (acting.current) return;
			if (!next || next.status === "none") close();
			else setState(next);
		});
	}, []);
	useEffect(load, [load]);
	useSessionChange(load);

	const act = useCallback(async (request: FrameRequest) => {
		acting.current = true;
		setBusy(true);
		setError("");
		const result = await ask<Done>(request);
		if (!result?.ok) {
			acting.current = false;
			setBusy(false);
			setError(result?.error ?? "That didn't work");
			return;
		}
		if (!result.message) return close();
		setDone(result.message);
		setTimeout(close, 1500);
	}, []);
	const decline = useCallback(
		(another: boolean) => act({ type: "vauly:passkey-decline", another }),
		[act],
	);

	// Escape turns the request down, like closing the browser's own prompt.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") void decline(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [decline]);

	if (done) {
		return (
			<Card>
				<p
					role="status"
					className="text-body-sm text-fg flex items-center gap-2 px-3 py-3"
				>
					<CheckCircleIcon weight="fill" className="text-success size-4" />
					{done}
				</p>
			</Card>
		);
	}
	if (!state || state.status === "none") return null;

	const another = (
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onClick={() => decline(true)}
		>
			Use another way
		</Button>
	);
	const title =
		state.status === "create" ||
		(state.status === "locked" && state.kind === "create")
			? `Save a passkey for ${state.rpId}?`
			: state.status === "exists"
				? `vauly has a passkey for ${state.rpId} already`
				: `Sign in to ${state.rpId} with a passkey?`;

	return (
		<Card>
			<section aria-label="Passkey" className="flex flex-col gap-3 p-3">
				<div className="flex items-start gap-2.5">
					<img src="/icon/32.png" alt="vauly" className="size-7 shrink-0" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<h2 className="text-body-sm text-fg font-medium">{title}</h2>
						<p className="text-caption text-fg-muted">
							{state.status === "locked" &&
								"vauly is locked. Unlock it to use your passkeys here."}
							{state.status === "create" &&
								`It signs you in${state.userName ? ` as ${state.userName}` : ""} with no password to type. vauly keeps it encrypted, like your passwords.`}
							{state.status === "exists" &&
								`It's in ${state.name}. Sign in with it instead of making another.`}
							{state.status === "get" &&
								"Choose the account. vauly signs in with its passkey."}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label="Cancel"
						disabled={busy}
						onClick={() => decline(false)}
					>
						<XIcon />
					</Button>
				</div>

				{state.status === "create" &&
					(state.into ? (
						<p className="text-caption text-fg-muted">
							It goes into your login {state.into.name} in {state.into.vault}.
						</p>
					) : (
						<Field label="Vault">
							<VaultSelect
								vaults={state.vaults}
								value={vaultId || (state.vaults[0]?.id ?? "")}
								onChange={setVaultId}
							/>
						</Field>
					))}

				{state.status === "get" && (
					<ul
						aria-label={`Passkeys for ${state.rpId}`}
						className="-mx-1 flex max-h-56 flex-col overflow-y-auto"
					>
						{state.passkeys.map((passkey) => (
							<li key={passkey.itemId}>
								<button
									type="button"
									disabled={busy}
									aria-label={`Sign in as ${passkey.userName || passkey.name}`}
									onClick={() =>
										act({ type: "vauly:passkey-use", itemId: passkey.itemId })
									}
									className="group/row hover:bg-tint/4 focus-visible:bg-tint/4 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none disabled:opacity-60"
								>
									<ItemLogo logo={passkey.logo} icon={GlobeIcon} />
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="text-body-sm text-fg truncate">
											{passkey.userName || passkey.name}
										</span>
										<span className="text-caption text-fg-subtle truncate">
											{passkey.name}
										</span>
									</span>
									<span className="text-caption text-brand opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100">
										Sign in
									</span>
								</button>
							</li>
						))}
					</ul>
				)}

				<FormError>{error}</FormError>
				<div className="flex justify-end gap-2">
					{another}
					{state.status === "locked" && (
						<Button
							variant="brand"
							size="sm"
							onClick={async () => {
								if (!(await openPopup()))
									setNote(
										"Click vauly among your browser's extensions to unlock.",
									);
							}}
						>
							Unlock
						</Button>
					)}
					{state.status === "create" && (
						<Button
							variant="brand"
							size="sm"
							disabled={busy || (!state.into && state.vaults.length === 0)}
							onClick={() =>
								act({
									type: "vauly:passkey-save",
									vaultId: vaultId || (state.vaults[0]?.id ?? ""),
								})
							}
						>
							{busy ? "Encrypting…" : "Save passkey"}
						</Button>
					)}
					{state.status === "exists" && (
						<Button
							variant="brand"
							size="sm"
							disabled={busy}
							onClick={() => decline(false)}
						>
							OK
						</Button>
					)}
				</div>
			</section>
			{note && <Note>{note}</Note>}
		</Card>
	);
}
