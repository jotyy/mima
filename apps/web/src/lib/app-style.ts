import { useEffect, useSyncExternalStore } from "react";

// Which look the app wears (see themes.css). Kept per device; Pure unless someone picks
// another.

export const APP_STYLES = [
	{ value: "pure", label: "Pure" },
	{ value: "frost", label: "Frost" },
	{ value: "classic", label: "Classic" },
] as const;

export const DEFAULT_STYLE = "pure";

export type AppStyle = (typeof APP_STYLES)[number]["value"];

const KEY = "mima.style";
const listeners = new Set<() => void>();

function read(): AppStyle {
	try {
		const stored = localStorage.getItem(KEY);
		return APP_STYLES.some((style) => style.value === stored)
			? (stored as AppStyle)
			: DEFAULT_STYLE;
	} catch {
		return DEFAULT_STYLE;
	}
}

export function setAppStyle(style: AppStyle) {
	try {
		localStorage.setItem(KEY, style);
	} catch {
		// Then it lasts until the page reloads.
	}
	for (const listener of listeners) listener();
}

export function useAppStyle() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		read,
		() => DEFAULT_STYLE as AppStyle,
	);
}

/** Puts the chosen style on <html> while the app is open, and takes it off after. */
export function useApplyAppStyle() {
	const style = useAppStyle();
	useEffect(() => {
		const root = document.documentElement;
		if (style === "classic") delete root.dataset.style;
		else root.dataset.style = style;
		return () => {
			delete root.dataset.style;
		};
	}, [style]);
}
