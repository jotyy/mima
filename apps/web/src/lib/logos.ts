import {
	BRANDFETCH_CLIENT_ID,
	logoUrl as brandLogoUrl,
} from "@mima/ui/lib/logos";
import { useSyncExternalStore } from "react";

export { brandDomain, logoDomain } from "@mima/ui/lib/logos";

// The browser asks Brandfetch for a logo by domain, so Brandfetch learns which brands'
// logos this device shows, and the address of this mima (its Referer, which it
// requires). Logos can be turned off per device in Settings, or for a whole instance
// with VITE_BRANDFETCH_CLIENT_ID=off.

const CLIENT_ID =
	(import.meta.env.VITE_BRANDFETCH_CLIENT_ID as string | undefined) ??
	BRANDFETCH_CLIENT_ID;

export const logoUrl = (domain: string, size: number) =>
	brandLogoUrl(domain, size, CLIENT_ID);

// Whether this device shows logos: on unless someone turned them off in Settings.

const KEY = "mima.logos";
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
