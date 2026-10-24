import { CheckCircleIcon } from "@phosphor-icons/react";
import { Button } from "@vauly/ui/components/button";
import { Input } from "@vauly/ui/components/input";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { Field, FormError } from "@/components/form";
import { SaveOffer } from "@/components/save-offer";
import {
	ask,
	type Done,
	type OfferState,
	type SaveWindowRequest,
} from "@/lib/messages";
import { unlockWith } from "@/lib/unlock";

// vauly's offer to save a login someone just typed into a site. The background opens it
// beside the page, not in it, so the page can't tell whether vauly had the login already.
// It never holds the password: saving hands back only what was edited. Closing the window
// is "Not now".

const tabId = location.hash.slice(1);

export default function App() {
	const [state, setState] = useState<OfferState | null>(null);
	const [done, setDone] = useState("");
	/** Saving clears the waiting login too; that mustn't close the window early. */
	const saving = useRef(false);
	const load = useCallback(() => {
		void ask<OfferState>({ type: "vauly:offer" }).then((next) => {
			if (saving.current) return;
			// Saved or dismissed somewhere else, such as the popup, or it ran out.
			if (!next || next.status === "none") window.close();
			else setState(next);
		});
	}, []);
	useEffect(load, [load]);

	// Again when vauly locks or unlocks, or the login stops waiting.
	useEffect(() => {
		const changed = (
			changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
			area: string,
		) => {
			if (
				area === "session" &&
				("unlocked" in changes || `capture:${tabId}` in changes)
			)
				load();
		};
		browser.storage.onChanged.addListener(changed);
		return () => browser.storage.onChanged.removeListener(changed);
	}, [load]);

	const send = async (request: SaveWindowRequest) => {
		saving.current = true;
		const result = await ask<Done>(request);
		if (!result?.ok) {
			saving.current = false;
			throw new Error(result?.error ?? "That didn't work");
		}
		setDone(result.message ?? "Done");
		setTimeout(() => window.close(), 1500);
	};
	const dismiss = async () => {
		await ask<Done>({ type: "vauly:dismiss" });
		window.close();
	};

	if (done) {
		return (
			<main className="flex min-h-screen items-center justify-center p-5">
				<p
					role="status"
					className="text-body-sm text-fg flex items-center gap-2"
				>
					<CheckCircleIcon weight="fill" className="text-success size-4" />
					{done}
				</p>
			</main>
		);
	}
	if (!state || state.status === "none") return null;

	if (state.status === "locked")
		return <Locked host={state.host} onDismiss={dismiss} />;

	return (
		<main className="p-2">
			<SaveOffer
				key={`${state.offer.kind}:${state.offer.username}`}
				onPage
				offer={state.offer}
				vaults={state.vaults}
				onSave={(vaultId, login) =>
					send({ type: "vauly:save", vaultId, ...login })
				}
				onUpdate={() => send({ type: "vauly:update" })}
				onDismiss={dismiss}
			/>
		</main>
	);
}

function Locked({ host, onDismiss }: { host: string; onDismiss: () => void }) {
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		setBusy(true);
		setError("");
		const problem = await unlockWith(password);
		setBusy(false);
		if (problem) {
			setPassword("");
			setError(problem);
		}
	};

	return (
		<main className="flex flex-col gap-3 p-5">
			<div className="flex items-start gap-2.5">
				<img src="/icon/32.png" alt="vauly" className="size-7 shrink-0" />
				<div className="flex min-w-0 flex-col gap-0.5">
					<h1 className="text-body-sm text-fg font-medium">
						Save this login to vauly?
					</h1>
					<p className="text-caption text-fg-muted">
						You just signed in on {host}. Unlock vauly to keep it; it waits for
						five minutes.
					</p>
				</div>
			</div>
			<form onSubmit={submit} className="flex flex-col gap-3">
				<Field label="Master password">
					<Input
						type="password"
						autoComplete="current-password"
						className="font-mono"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
					/>
				</Field>
				<FormError>{error}</FormError>
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
						Not now
					</Button>
					<Button type="submit" variant="brand" size="sm" disabled={busy}>
						{busy ? "Unlocking…" : "Unlock"}
					</Button>
				</div>
			</form>
		</main>
	);
}
