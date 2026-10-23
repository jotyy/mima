import { Button } from "@mima/ui/components/button";
import { CheckCircleIcon, GlobeIcon } from "@phosphor-icons/react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { ItemLogo } from "@/components/item-logo";
import { SaveOffer } from "@/components/save-offer";
import {
	ask,
	type Done,
	type FillResult,
	type FrameRequest,
	type MenuLogin,
	type MenuState,
	type OfferState,
} from "@/lib/messages";

// mima's frame inside a site's page. The page script decides where it goes; what it
// shows comes from the background, which knows the tab it's in.

const view = location.hash === "#save" ? "save" : "menu";

export function tellPage(
	message: { mima: "size"; height: number } | { mima: "close" },
) {
	window.parent.postMessage(message, "*");
}

const close = () => tellPage({ mima: "close" });

export default function App() {
	return view === "save" ? <Save /> : <Menu />;
}

/** Runs again when the extension locks or unlocks, or a waiting login comes or goes. */
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
				Object.keys(changes).some((key) => key.startsWith("capture:"))
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
		void ask<MenuState>({ type: "mima:menu" }).then(setState);
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
							{locked ? "mima is locked" : "Sign in to mima"}
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
									"Click mima among your browser's extensions to continue.",
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
		const result = await ask<FillResult>({ type: "mima:fill", id: login.id });
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
					Nothing saved for {state.host} yet. Sign in, and mima offers to keep
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
					mima
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
		void ask<OfferState>({ type: "mima:offer" }).then((next) => {
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
		await ask<Done>({ type: "mima:dismiss" });
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
						<img src="/icon/32.png" alt="mima" className="size-7 shrink-0" />
						<div className="flex min-w-0 flex-col gap-0.5">
							<h2 className="text-body-sm text-fg font-medium">
								Save this login to mima?
							</h2>
							<p className="text-caption text-fg-muted">
								You just signed in on {state.host}. Unlock mima to keep it; it
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
										"Click mima among your browser's extensions to unlock.",
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
				send({ type: "mima:save", vaultId, ...login })
			}
			onUpdate={() => send({ type: "mima:update" })}
			onDismiss={dismiss}
		/>
	);
}
