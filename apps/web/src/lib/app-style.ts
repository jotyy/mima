import { useEffect, useSyncExternalStore } from "react";

// Which look the app wears (see themes.css). Kept per device; "classic" is mima's own.

export const APP_STYLES = [
	{ value: "classic", label: "Classic" },
	{ value: "frost", label: "Frost" },
	{ value: "pure", label: "Pure" },
	{ value: "glass", label: "Glass" },
] as const;

export type AppStyle = (typeof APP_STYLES)[number]["value"];

const KEY = "mima.style";
const listeners = new Set<() => void>();

function read(): AppStyle {
	try {
		const stored = localStorage.getItem(KEY);
		return APP_STYLES.some((style) => style.value === stored)
			? (stored as AppStyle)
			: "classic";
	} catch {
		return "classic";
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
		() => "classic" as AppStyle,
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
