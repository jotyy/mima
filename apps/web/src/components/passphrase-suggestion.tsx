import { Button } from "@vauly/ui/components/button";
import { useState } from "react";

import { MASTER_PASSPHRASE } from "@/lib/generator";
import {
	generatePassphrase,
	loadWordlist,
	passphraseBits,
} from "@/lib/passphrase";

/**
 * Offers a passphrase for a new master password: six random words, easier to remember
 * and to type than random characters, and strong enough for the key to everything.
 */
export function PassphraseSuggestion({
	onUse,
}: {
	onUse: (passphrase: string) => void;
}) {
	const [phrase, setPhrase] = useState<string | null>(null);
	const suggest = async () =>
		setPhrase(generatePassphrase(await loadWordlist(), MASTER_PASSPHRASE));

	if (!phrase) {
		return (
			<Button
				type="button"
				variant="ghost"
				size="xs"
				className="self-start"
				onClick={() => void suggest()}
			>
				Suggest a passphrase
			</Button>
		);
	}
	return (
		<div className="border-line flex flex-col gap-2 rounded-lg border px-3 py-2.5">
			<span className="text-caption text-fg-muted">
				Six random words, {Math.round(passphraseBits(MASTER_PASSPHRASE))} bits.
				Learn them, or write them down somewhere safe.
			</span>
			<span
				className="text-body-sm text-fg font-mono break-all"
				data-testid="suggested-passphrase"
			>
				{phrase}
			</span>
			<div className="flex gap-2">
				<Button type="button" size="xs" onClick={() => onUse(phrase)}>
					Use it
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onClick={() => void suggest()}
				>
					Another
				</Button>
			</div>
		</div>
	);
}
