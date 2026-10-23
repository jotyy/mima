// Brand logos for items, from Brandfetch's logo CDN, shared by the web app and the
// browser extension. Only a brand's own domain is ever looked up: never a subdomain,
// a private network name or anything else from the item.

/** The mima project's Brandfetch client ID; an instance can use its own. */
export const BRANDFETCH_CLIENT_ID = "1idzU4xXvIcwxy_dNwT";

type Kind = "login" | "api-key" | "note" | "ssh-key";

/** Well-known services, found by name for items without a website (API keys, mostly). */
const brands: [RegExp, string][] = [
	[/\bgithub\b/, "github.com"],
	[/\bgitlab\b/, "gitlab.com"],
	[/\bbitbucket\b/, "bitbucket.org"],
	[/\bstripe\b/, "stripe.com"],
	[/\bopenai\b|\bchatgpt\b/, "openai.com"],
	[/\banthropic\b|\bclaude\b/, "anthropic.com"],
	[/\baws\b|\bamazon web services\b/, "aws.amazon.com"],
	[/\bgoogle cloud\b|\bgcp\b/, "cloud.google.com"],
	[/\bgoogle\b|\bgmail\b/, "google.com"],
	[/\bazure\b/, "azure.microsoft.com"],
	[/\bmicrosoft\b|\boffice 365\b|\boutlook\b/, "microsoft.com"],
	[/\bcloudflare\b/, "cloudflare.com"],
	[/\bvercel\b/, "vercel.com"],
	[/\bnetlify\b/, "netlify.com"],
	[/\bheroku\b/, "heroku.com"],
	[/\bdigitalocean\b/, "digitalocean.com"],
	[/\bhetzner\b/, "hetzner.com"],
	[/\bfly\.io\b/, "fly.io"],
	[/\brailway\b/, "railway.com"],
	[/\bsupabase\b/, "supabase.com"],
	[/\bfirebase\b/, "firebase.google.com"],
	[/\bmongodb\b|\bmongo\b/, "mongodb.com"],
	[/\bpostgres(ql)?\b/, "postgresql.org"],
	[/\bredis\b/, "redis.io"],
	[/\bdocker\b/, "docker.com"],
	[/\bnpm\b/, "npmjs.com"],
	[/\bsentry\b/, "sentry.io"],
	[/\bdatadog\b/, "datadoghq.com"],
	[/\bgrafana\b/, "grafana.com"],
	[/\btwilio\b/, "twilio.com"],
	[/\bsendgrid\b/, "sendgrid.com"],
	[/\bmailgun\b/, "mailgun.com"],
	[/\bresend\b/, "resend.com"],
	[/\bslack\b/, "slack.com"],
	[/\bdiscord\b/, "discord.com"],
	[/\bnotion\b/, "notion.so"],
	[/\blinear\b/, "linear.app"],
	[/\bjira\b|\batlassian\b|\bconfluence\b/, "atlassian.com"],
	[/\bfigma\b/, "figma.com"],
	[/\bzoom\b/, "zoom.us"],
	[/\bdropbox\b/, "dropbox.com"],
	[/\bshopify\b/, "shopify.com"],
	[/\bpaypal\b/, "paypal.com"],
	[/\bhubspot\b/, "hubspot.com"],
	[/\bsalesforce\b/, "salesforce.com"],
	[/\bmailchimp\b/, "mailchimp.com"],
	[/\balgolia\b/, "algolia.com"],
	[/\bauth0\b/, "auth0.com"],
	[/\bokta\b/, "okta.com"],
	[/\bapple\b|\bicloud\b/, "apple.com"],
	[/\bfacebook\b|\bmeta\b/, "facebook.com"],
	[/\binstagram\b/, "instagram.com"],
	[/\blinkedin\b/, "linkedin.com"],
	[/\btwitter\b|\bx\.com\b/, "x.com"],
];

function hostOf(url: string) {
	try {
		const { hostname } = new URL(
			/^\w+:\/\//.test(url) ? url : `https://${url}`,
		);
		return hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

// Names that only mean something on a private network: never sent anywhere.
const PRIVATE_SUFFIX =
	/\.(local|localhost|internal|intranet|lan|home|corp|test|example|invalid)$/;

/**
 * The part of a host a brand owns: "app.hubspot.com" → "hubspot.com", and
 * "shop.example.co.uk" → "example.co.uk". Subdomains, which can name internal systems,
 * stay on the device.
 */
export function brandDomain(host: string) {
	const labels = host.toLowerCase().split(".").filter(Boolean);
	if (labels.length < 2) return null;
	if (/^\d+$/.test(labels.at(-1) ?? "")) return null;
	const joined = labels.join(".");
	if (PRIVATE_SUFFIX.test(`.${joined}`)) return null;
	const take = /^(co|com|net|org|gov|edu|ac|ne|or)\.[a-z]{2}$/.test(
		labels.slice(-2).join("."),
	)
		? 3
		: 2;
	return labels.slice(-take).join(".");
}

/** The domain whose logo stands for an item, or null to keep the plain icon. */
export function logoDomain(item: { kind: Kind; name: string; url?: string }) {
	if (item.url) {
		const domain = brandDomain(hostOf(item.url));
		if (domain) return domain;
	}
	// A note named "Apple pie" is no Apple account.
	if (item.kind === "note") return null;
	const name = item.name.toLowerCase();
	return brands.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** A square icon, twice the shown size for sharp screens; a 404 when there's none. */
export function logoUrl(
	domain: string,
	size: number,
	clientId = BRANDFETCH_CLIENT_ID,
) {
	const px = size * 2;
	return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/${px}/h/${px}/fallback/404/icon?c=${clientId}`;
}
