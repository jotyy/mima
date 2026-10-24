// Names a signed-in session from its user agent: "Chrome on macOS". The app shows it in
// Settings, and the server puts it in the notification about a new sign-in.

export type Device = { label: string; phone: boolean };

const browsers: [RegExp, string][] = [
	[/Edg(e|A|iOS)?\//, "Edge"],
	[/OPR\/|Opera/, "Opera"],
	[/Firefox\/|FxiOS\//, "Firefox"],
	[/Chrome\/|CriOS\//, "Chrome"],
	[/Version\/[\d.]+.*Safari\//, "Safari"],
];

const systems: [RegExp, string][] = [
	[/iPhone/, "iPhone"],
	[/iPad/, "iPad"],
	[/Android/, "Android"],
	[/CrOS/, "ChromeOS"],
	[/Mac OS X|Macintosh/, "macOS"],
	[/Windows/, "Windows"],
	[/Linux/, "Linux"],
];

export function describeDevice(userAgent: string | null | undefined): Device {
	const ua = userAgent ?? "";
	const browser = browsers.find(([pattern]) => pattern.test(ua))?.[1];
	const system = systems.find(([pattern]) => pattern.test(ua))?.[1];
	const phone = /iPhone|Android.*Mobile/.test(ua);
	if (browser && system) return { label: `${browser} on ${system}`, phone };
	return { label: browser ?? system ?? "Unknown device", phone };
}
