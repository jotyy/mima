// Payment cards: the brand a number belongs to, whether it passes the Luhn check, and how
// its expiry is written. The web app and the browser extension share these; nothing here
// leaves the device.

/** A card as an item holds it. The number, security code and PIN are hidden until revealed. */
export type Card = {
	cardholder?: string;
	number?: string;
	/** "MM/YYYY". */
	expiry?: string;
	/** The security code: CVV, CVC or CID. */
	code?: string;
	pin?: string;
};

export type CardBrand = {
	name: string;
	/** Whose logo stands for it. */
	domain: string;
	/** How a number of this brand is grouped for reading. */
	groups: number[];
};

// The ranges each brand's numbers start with. Order matters: American Express and
// Diners Club come before the broader patterns.
const brands: [RegExp, CardBrand][] = [
	[
		/^3[47]/,
		{
			name: "American Express",
			domain: "americanexpress.com",
			groups: [4, 6, 5],
		},
	],
	[
		/^3(0[0-5]|[689])/,
		{ name: "Diners Club", domain: "dinersclub.com", groups: [4, 6, 4] },
	],
	[
		/^35(2[89]|[3-8])/,
		{ name: "JCB", domain: "jcb.co.jp", groups: [4, 4, 4, 4] },
	],
	[/^4/, { name: "Visa", domain: "visa.com", groups: [4, 4, 4, 4, 3] }],
	[
		/^(5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/,
		{ name: "Mastercard", domain: "mastercard.com", groups: [4, 4, 4, 4] },
	],
	[
		/^(6011|65|64[4-9])/,
		{ name: "Discover", domain: "discover.com", groups: [4, 4, 4, 4, 3] },
	],
	[
		/^62/,
		{ name: "UnionPay", domain: "unionpayintl.com", groups: [4, 4, 4, 4, 3] },
	],
];

export const digitsOf = (number: string) => number.replace(/\D/g, "");

/** The brand a card number belongs to, from its first digits, or null. */
export function cardBrand(number: string | undefined) {
	const digits = digitsOf(number ?? "");
	if (digits.length < 2) return null;
	return brands.find(([pattern]) => pattern.test(digits))?.[1] ?? null;
}

/** Whether a number passes the Luhn check every card number passes: a typo usually doesn't. */
export function luhnValid(number: string) {
	const digits = digitsOf(number);
	if (digits.length < 12 || digits.length > 19) return false;
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let digit = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

export const lastFour = (number: string | undefined) =>
	digitsOf(number ?? "").slice(-4);

/** The number in its brand's groups, "4111 1111 1111 1111", for reading it out. */
export function formatCardNumber(number: string) {
	const digits = digitsOf(number);
	const groups = cardBrand(digits)?.groups ?? [4, 4, 4, 4, 4];
	const parts: string[] = [];
	let at = 0;
	for (const size of groups) {
		if (at >= digits.length) break;
		parts.push(digits.slice(at, at + size));
		at += size;
	}
	if (at < digits.length) parts.push(digits.slice(at));
	return parts.join(" ");
}

/**
 * An expiry as "MM/YYYY", from the ways apps write it: "6/30", "06/2030", "2030-06",
 * "203006", or a month and a year apart. Empty when it isn't a month and a year.
 */
export function normalizeExpiry(value: string, year?: string) {
	const text = value.trim();
	let month = "";
	let full = "";
	const together = year === undefined;
	if (!together) {
		month = text;
		full = year.trim();
	} else if (/^\d{4}-\d{1,2}/.test(text)) {
		[full = "", month = ""] = text.split("-");
	} else if (/^\d{6}$/.test(text)) {
		full = text.slice(0, 4);
		month = text.slice(4);
	} else {
		const match = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(text);
		if (!match) return "";
		month = match[1] ?? "";
		full = match[2] ?? "";
	}
	const m = Number(month);
	if (!Number.isInteger(m) || m < 1 || m > 12) return "";
	if (/^\d{2}$/.test(full)) full = `20${full}`;
	if (!/^\d{4}$/.test(full)) return "";
	return `${String(m).padStart(2, "0")}/${full}`;
}

/** "06/2030" as cards print it: "06/30". */
export const shortExpiry = (expiry: string) =>
	/^\d{2}\/\d{4}$/.test(expiry)
		? `${expiry.slice(0, 3)}${expiry.slice(5)}`
		: expiry;
