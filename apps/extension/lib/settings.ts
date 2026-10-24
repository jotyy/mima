// What the person chose for this browser, in the extension's local storage. Nothing here
// is secret, and none of it depends on what the vaults hold.

export type PasskeySettings = {
	/** Whether vauly asks when a site wants a passkey; off, the browser answers. */
	offer: boolean;
	/** Sites (relying party IDs) where vauly doesn't ask. */
	notOn: string[];
};

const KEY = "passkeys";

export async function getPasskeySettings(): Promise<PasskeySettings> {
	const stored = (await browser.storage.local.get(KEY))[KEY] as
		| Partial<PasskeySettings>
		| undefined;
	return {
		offer: stored?.offer ?? true,
		notOn: Array.isArray(stored?.notOn)
			? stored.notOn.filter((site) => typeof site === "string")
			: [],
	};
}

export function savePasskeySettings(settings: PasskeySettings) {
	return browser.storage.local.set({ [KEY]: settings });
}

export async function offersPasskeysFor(rpId: string) {
	const { offer, notOn } = await getPasskeySettings();
	return offer && !notOn.includes(rpId);
}

/** Stops vauly asking on one site; the popup's settings can undo it. */
export async function stopOffering(rpId: string) {
	const settings = await getPasskeySettings();
	if (settings.notOn.includes(rpId)) return;
	await savePasskeySettings({
		...settings,
		notOn: [...settings.notOn, rpId].sort().slice(-200),
	});
}
