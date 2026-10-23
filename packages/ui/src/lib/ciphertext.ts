// The sky behind the website's hero and the sign-in screens is full of ciphertext. A
// keyhole reads it: through it the same rows show as a team's items. Both sets of rows
// match character for character, so only the keyhole tells them apart.

const words = [
	"GitHub",
	"alex@acme.example",
	"r7#Lq2v!Wm9e-Tb4",
	"Stripe live key",
	"sk_live_51NxQ2vLr8KcT",
	"Postgres · staging",
	"postgres://app:h4Kq9@db",
	"Office Wi-Fi",
	"lighthouse-42",
	"AWS root",
	"ops@acme.example",
	"Figma",
	"design@acme.example",
	"Vercel token",
	"Linear",
	"deploy@prod",
	"ssh-ed25519 AAAAC3NzaC1",
	"Door code 4417",
	"Recovery codes",
	"OPENAI_API_KEY",
	"Cloudflare token",
	"Notion",
	"Sentry DSN",
	"Datadog API key",
	"Hn8$wQ2!zR5p",
	"kim@acme.example",
	"Backup server",
	"JBSWY3DPEHPK3PXP",
	"riley@acme.example",
	"Google Workspace",
	"Wi-Fi guest",
	"pk_test_9Kd2",
	"Docker Hub",
	"acmebot",
	"Supabase service key",
	"Qm7&vT3#nW8x",
	"Build runner",
	"jordan@acme.example",
];
const BASE64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Rows of made-up items and the same rows as ciphertext. The seed is fixed, so the rows
 * are the same on every build and every load.
 */
export function cipherRows(rows: number, width = 320) {
	let seed = 20261023;
	const random = () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	const plain: string[] = [];
	const cipher: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = " ".repeat(Math.floor(random() * 12));
		while (line.length < width)
			line += `${words[Math.floor(random() * words.length)]}   `;
		plain.push(line);
		cipher.push(
			[...line]
				.map((char) =>
					char === " " ? " " : BASE64[Math.floor(random() * BASE64.length)],
				)
				.join(""),
		);
	}
	return { plain, cipher };
}

/** The keyhole's outline, in a 200 × 280 box. */
export const keyhole =
	"M100 30a60 60 0 0 1 30.6 111.6L143 257H57l12.4-115.4A60 60 0 0 1 100 30z";
