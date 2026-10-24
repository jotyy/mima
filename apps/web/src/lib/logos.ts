import { cardBrand } from "@vauly/ui/lib/cards";
import {
	BRANDFETCH_CLIENT_ID,
	logoUrl as brandLogoUrl,
	logoDomain as serviceLogo,
} from "@vauly/ui/lib/logos";
import { useSyncExternalStore } from "react";

import { instance } from "../config";

export { brandDomain } from "@vauly/ui/lib/logos";

/**
 * The domain whose logo stands for an item: a card's brand, found from its number on
 * this device, or the service a login or key belongs to.
 */
export const logoDomain = (item: {
	kind: string;
	name: string;
	url?: string;
	card?: { number?: string };
}) =>
	item.kind === "card"
		? (cardBrand(item.card?.number)?.domain ?? null)
		: serviceLogo(item);

// The browser asks Brandfetch for a logo by domain, so Brandfetch learns which brands'
// logos this device shows, and the address of this vauly (its Referer, which it
// requires). Logos can be turned off per device in Settings, or for a whole instance
// with VITE_BRANDFETCH_CLIENT_ID=off (in /vauly.json).

const CLIENT_ID = instance().brandfetch || BRANDFETCH_CLIENT_ID;

export const logoUrl = (domain: string, size: number) =>
	brandLogoUrl(domain, size, CLIENT_ID);

// Whether this device shows logos: on unless someone turned them off in Settings.

const KEY = "vauly.logos";
const listeners = new Set<() => void>();

function read() {
	if (CLIENT_ID === "off") return false;
	try {
		return localStorage.getItem(KEY) !== "off";
	} catch {
		return true;
	}
}

export function setLogosShown(shown: boolean) {
	try {
		localStorage.setItem(KEY, shown ? "on" : "off");
	} catch {
		// Then the choice lasts until the page reloads.
	}
	for (const listener of listeners) listener();
}

export function useLogosShown() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		read,
		() => false,
	);
}

/** False when the instance turned logos off altogether. */
export const logosAvailable = CLIENT_ID !== "off";
