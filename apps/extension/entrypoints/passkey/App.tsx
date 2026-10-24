import { GlobeIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { Input } from "@vauly/ui/components/input";
import {
	type FormEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { Field, FormError } from "@/components/form";
import { ItemLogo } from "@/components/item-logo";
import { VaultSelect } from "@/components/save-offer";
import {
	ask,
	type Done,
	type PasskeyPrompt,
	type PasskeyState,
	type PasskeyWindowRequest,
} from "@/lib/messages";
import { getConnection, saveConnection, saveUnlocked } from "@/lib/storage";
import { TwoStepError, unlock, WrongPasswordError } from "@/lib/vault";

// vauly's passkey window. The background opens it when a site asks for a passkey, outside
// the site's page, so the site can't see it, cover it or click in it. Choosing here is the
// person being present; the master password, entered here or a few minutes before, is
// them being verified. Closing the window turns the request down.

export default function App() {
	const [state, setState] = useState<PasskeyState | null>(null);
	/** Answering clears the waiting request too; that mustn't close the window early. */
	const acting = useRef(false);
	const load = useCallback(() => {
		void ask<PasskeyState>({ type: "vauly:passkey-state" }).then((next) => {
			if (acting.current) return;
			if (!next || next.status === "none") window.close();
			else setState(next);
		});
	}, []);
	useEffect(load, [load]);

	// Again when vauly locks or unlocks, or the request goes.
	useEffect(() => {
		const changed = (
			changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
			area: string,
		) => {
			if (area === "session" && ("unlocked" in changes || "passkey" in changes))
				load();
		};
		browser.storage.onChanged.addListener(changed);
		return () => browser.storage.onChanged.removeListener(changed);
	}, [load]);

	if (!state || state.status === "none") return null;
	return <Prompt key={state.status} state={state} acting={acting} />;
}

function Prompt({
	state,
	acting,
}: {
	state: PasskeyPrompt;
	acting: { current: boolean };
}) {
	const [vaultId, setVaultId] = useState("");
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const act = useCallback(
		async (request: PasskeyWindowRequest) => {
			acting.current = true;
			setBusy(true);
			setError("");
			const result = await ask<Done>(request);
			if (result?.ok) return window.close();
			acting.current = false;
			setBusy(false);
			setError(result?.ok === false ? result.error : "That didn't work");
		},
		[acting],
	);
	const decline = useCallback(
		(another: boolean) => act({ type: "vauly:passkey-decline", another }),
		[act],
	);

	// Escape turns the request down, like closing the browser's own passkey dialog.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") void decline(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [decline]);

	const askPassword =
		state.status === "locked" ||
		(state.status === "create" && state.verify) ||
		(state.status === "get" && state.verify && state.passkeys.length > 0);

	/** Checks the master password, which unlocks vauly or confirms it's still them. */
	const checkPassword = async () => {
		if (!askPassword) return true;
		if (!password) {
			setError("Enter your master password first.");
			return false;
		}
		setBusy(true);
		setError("");
		try {
			const connection = await getConnection();
			const result = await unlock(
				{
					server: connection.server ?? "",
					email: connection.email ?? "",
					token: connection.token || undefined,
				},
				password,
			);
			await saveConnection({ token: result.token });
			await saveUnlocked(result.privateKey, result.publicKey);
			return true;
		} catch (err) {
			setPassword("");
			setError(
				err instanceof WrongPasswordError
					? "That's not your master password."
					: err instanceof TwoStepError
						? "Sign in again from vauly's button in the toolbar."
						: (err as Error).message,
			);
			return false;
		} finally {
			setBusy(false);
		}
	};
	const then = (request: PasskeyWindowRequest) => async () => {
		if (await checkPassword()) await act(request);
	};
	const unlockOnly = async (event: FormEvent) => {
		event.preventDefault();
		await checkPassword();
	};

	const creating = state.kind === "create";
	const title =
		state.status === "exists"
			? `vauly has a passkey for ${state.rpId} already`
			: creating
				? `Save a passkey for ${state.rpId}?`
				: `Sign in to ${state.rpId} with a passkey?`;

	return (
		<main className="flex min-h-screen flex-col gap-4 p-5">
			<div className="flex items-start gap-3">
				<img src="/icon/48.png" alt="vauly" className="size-9 shrink-0" />
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h1 className="text-body text-fg font-medium">{title}</h1>
					<p className="text-caption text-fg-muted">
						Asked by <span className="text-fg font-medium">{state.site}</span>
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Cancel"
					disabled={busy}
					onClick={() => decline(false)}
				>
					<XIcon />
				</Button>
			</div>

			{state.status === "locked" && (
				<Text>vauly is locked. Unlock it to use your passkeys here.</Text>
			)}
			{state.status === "create" && (
				<Text>
					It signs you in{state.userName ? ` as ${state.userName}` : ""} with no
					password to type. vauly keeps it encrypted, like your passwords.
				</Text>
			)}
			{state.status === "exists" && (
				<Text>
					It's in {state.name}. Sign in with it instead of making another.
				</Text>
			)}
			{state.status === "get" && state.passkeys.length === 0 && (
				<Text>
					vauly has no passkey that {state.rpId} accepts. Use another way to
					sign in with one on this device, your phone or a security key.
				</Text>
			)}

			{state.status === "create" &&
				(state.into ? (
					<Text>
						It goes into your login {state.into.name} in {state.into.vault}.
					</Text>
				) : (
					<Field label="Vault">
						<VaultSelect
							vaults={state.vaults}
							value={vaultId || (state.vaults[0]?.id ?? "")}
							onChange={setVaultId}
						/>
					</Field>
				))}

			{askPassword && (
				<form onSubmit={unlockOnly}>
					<Field
						label={
							state.status === "locked"
								? "Master password"
								: "Your master password, to confirm it's you"
						}
					>
						<Input
							type="password"
							autoFocus
							autoComplete="current-password"
							className="font-mono"
							value={password}
							onChange={(event) => setPassword(event.target.value)}
						/>
					</Field>
				</form>
			)}

			{state.status === "get" && state.passkeys.length > 0 && (
				<ul
					aria-label={`Passkeys for ${state.rpId}`}
					className="-mx-1 flex flex-col"
				>
					{state.passkeys.map((passkey) => (
						<li key={passkey.itemId}>
							<button
								type="button"
								disabled={busy}
								aria-label={`Sign in as ${passkey.userName || passkey.name}`}
								onClick={then({
									type: "vauly:passkey-use",
									itemId: passkey.itemId,
								})}
								className="group/row hover:bg-tint/4 focus-visible:bg-tint/4 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none disabled:opacity-60"
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

			<div className="mt-auto flex items-center justify-end gap-2">
				{state.status !== "exists" && (
					<button
						type="button"
						disabled={busy}
						onClick={() =>
							act({
								type: "vauly:passkey-decline",
								another: true,
								notHere: true,
							})
						}
						className="text-caption text-fg-subtle hover:text-fg mr-auto underline-offset-2 hover:underline"
					>
						Don't ask on {state.rpId}
					</button>
				)}
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => decline(true)}
				>
					Use another way
				</Button>
				{state.status === "locked" && (
					<Button
						variant="brand"
						size="sm"
						disabled={busy}
						onClick={checkPassword}
					>
						{busy ? "Unlocking…" : "Unlock"}
					</Button>
				)}
				{state.status === "create" && (
					<Button
						variant="brand"
						size="sm"
						disabled={busy || (!state.into && state.vaults.length === 0)}
						onClick={then({
							type: "vauly:passkey-save",
							vaultId: vaultId || (state.vaults[0]?.id ?? ""),
						})}
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
		</main>
	);
}

function Text({ children }: { children: ReactNode }) {
	return <p className="text-body-sm text-fg-muted">{children}</p>;
}
