// How this instance is set up: its API's address, its logo and breach-check settings, and
// the demo account on the demo. They come from /vauly.json when the app starts, not from
// the build, so every instance of a version serves the same files and anyone can check
// them (vauly verify). The last copy stays on the device, to start without a connection.

export type InstanceConfig = {
	/** The API's address; empty when the app and the API share one origin. */
	server: string;
	/** Brandfetch's client ID for logos: empty for vauly's own, "off" for none. */
	brandfetch: string;
	breachCheck: boolean;
	demo?: { email: string; password: string };
};

const KEY = "vauly.config";
const defaults: InstanceConfig = {
	server: "",
	brandfetch: "",
	breachCheck: true,
};
let current = defaults;

function parse(value: unknown): InstanceConfig {
	const raw = (value && typeof value === "object" ? value : {}) as Record<
		string,
		unknown
	>;
	const demo = raw.demo as { email?: unknown; password?: unknown } | undefined;
	return {
		server: typeof raw.server === "string" ? raw.server : "",
		brandfetch: typeof raw.brandfetch === "string" ? raw.brandfetch : "",
		breachCheck: raw.breachCheck !== false,
		...(typeof demo?.email === "string" && {
			demo: {
				email: demo.email,
				password: typeof demo.password === "string" ? demo.password : "",
			},
		}),
	};
}

/** Reads /vauly.json, or the last copy of it when the server can't be reached. */
export async function loadConfig() {
	try {
		const response = await fetch("/vauly.json", { cache: "no-store" });
		if (response.ok) {
			current = parse(await response.json());
			try {
				localStorage.setItem(KEY, JSON.stringify(current));
			} catch {
				// Then starting offline uses the defaults.
			}
			return;
		}
	} catch {
		// Offline: fall back on the last copy below.
	}
	try {
		const saved = localStorage.getItem(KEY);
		if (saved) current = parse(JSON.parse(saved));
	} catch {
		// Nothing saved: the defaults stand.
	}
}

/** The instance's settings. Read after loadConfig, which main.tsx awaits before the app. */
export const instance = () => current;
