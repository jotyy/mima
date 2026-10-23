// Have I Been Pwned's Pwned Passwords, asked with k-anonymity. The password's SHA-1 is
// worked out on this device, and only its first five hex characters leave it. The service
// answers with every hash it knows that starts with them, padded with made-up ones, and
// the match happens here. Nothing in this file touches the DOM or the app's settings, so
// the build can read the origin from it too.

export const PWNED_PASSWORDS_ORIGIN = "https://api.pwnedpasswords.com";

/** How often each hash suffix under one prefix was seen. */
export type Range = Map<string, number>;

export async function sha1Hex(text: string) {
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(text),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	)
		.join("")
		.toUpperCase();
}

/** Reads a range response: `SUFFIX:COUNT` lines; padding lines count 0 and are dropped. */
export function parseRange(body: string): Range {
	const range: Range = new Map();
	for (const line of body.split("\n")) {
		const [suffix, count] = line.trim().split(":");
		const seen = Number(count);
		if (suffix && seen > 0) range.set(suffix.toUpperCase(), seen);
	}
	return range;
}

export async function fetchRange(prefix: string): Promise<Range> {
	const response = await fetch(`${PWNED_PASSWORDS_ORIGIN}/range/${prefix}`, {
		headers: { "Add-Padding": "true" },
		credentials: "omit",
		// Which vauly is asking is none of their business.
		referrerPolicy: "no-referrer",
	});
	if (!response.ok) {
		throw new Error(`Pwned Passwords answered ${response.status}`);
	}
	return parseRange(await response.text());
}

/** How many times a password turned up in known breaches: 0 when it never did. */
export async function pwnedCount(
	password: string,
	range: (prefix: string) => Promise<Range> = fetchRange,
) {
	const hash = await sha1Hex(password);
	return (await range(hash.slice(0, 5))).get(hash.slice(5)) ?? 0;
}
