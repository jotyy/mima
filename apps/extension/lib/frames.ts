// mima's frames inside a page: the fill menu under a login field, and the save prompt in
// the top corner. Each is an iframe of the extension's own page, so the site can't read
// what's in it; the page script only places it and sizes it.

export type View = "menu" | "save";

/** Room around the card inside the frame, for its shadow. */
const PAD = 12;
const MENU_WIDTH = { min: 300, max: 380 };
const SAVE_WIDTH = 360;
const MAX_HEIGHT = 440;

type Mounted = {
	host: HTMLElement;
	frame: HTMLIFrameElement;
	anchor?: HTMLInputElement;
};

export function mountFrames() {
	const open = new Map<View, Mounted>();

	const place = (view: View) => {
		const mounted = open.get(view);
		if (!mounted) return;
		const { host, frame, anchor } = mounted;
		if (view === "save") {
			Object.assign(host.style, { top: "4px", right: "4px" });
			frame.style.width = `${SAVE_WIDTH + PAD * 2}px`;
			return;
		}
		if (!anchor?.isConnected || anchor.getClientRects().length === 0) {
			close("menu");
			return;
		}
		const rect = anchor.getBoundingClientRect();
		const width = Math.min(
			MENU_WIDTH.max,
			Math.max(MENU_WIDTH.min, rect.width),
		);
		const height = frame.offsetHeight;
		// Under the field, unless there's more room above it.
		const below = window.innerHeight - rect.bottom;
		const top =
			below < height && rect.top > below
				? rect.top - 4 - height + PAD
				: rect.bottom + 4 - PAD;
		Object.assign(host.style, {
			top: `${top}px`,
			left: `${Math.max(0, rect.left - PAD)}px`,
		});
		frame.style.width = `${width + PAD * 2}px`;
	};

	const show = (view: View, anchor?: HTMLInputElement) => {
		const current = open.get(view);
		if (current && current.anchor === anchor) return;
		if (current) close(view);

		const host = document.createElement("mima-frame");
		host.style.cssText =
			"all: initial; position: fixed; z-index: 2147483647; display: block;";
		const shadow = host.attachShadow({ mode: "open" });
		const frame = document.createElement("iframe");
		frame.src = `${browser.runtime.getURL("/inline.html")}#${view}`;
		frame.title = view === "menu" ? "mima: fill a login" : "mima: save a login";
		// The frame copies a one-time code after filling.
		frame.allow = "clipboard-write";
		frame.style.cssText =
			"display: block; border: 0; background: transparent; color-scheme: normal; height: 0;";
		shadow.appendChild(frame);
		document.documentElement.appendChild(host);
		open.set(view, { host, frame, anchor });
		place(view);
	};

	const close = (view: View) => {
		open.get(view)?.host.remove();
		open.delete(view);
	};

	// The frame says how tall it is, and when it's done.
	window.addEventListener("message", (event) => {
		for (const [view, { frame }] of open) {
			if (event.source !== frame.contentWindow) continue;
			const data = event.data as { mima?: string; height?: number };
			if (data.mima === "size" && typeof data.height === "number") {
				frame.style.height = `${Math.min(MAX_HEIGHT, Math.ceil(data.height))}px`;
				place(view);
			}
			if (data.mima === "close") close(view);
		}
	});

	const follow = () => place("menu");
	window.addEventListener("scroll", follow, { capture: true, passive: true });
	window.addEventListener("resize", follow, { passive: true });

	// Clicks inside a frame don't reach the page, so any click the page sees is outside.
	document.addEventListener(
		"mousedown",
		(event) => {
			const menu = open.get("menu");
			if (menu && event.target !== menu.anchor) close("menu");
		},
		true,
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") close("menu");
		},
		true,
	);

	return {
		show,
		close,
		anchor: () => open.get("menu")?.anchor,
	};
}
