/** The landing page's questions, which its structured data repeats for search engines. */
export const questions = [
	{
		q: "Is vauly free?",
		a: "Yes. It's open source under AGPL-3.0. You only pay for your own Cloudflare account, and a small team usually fits in the free plan.",
	},
	{
		q: "Can anyone at vauly see our data?",
		a: "There's no one to ask. There is no vauly cloud: it runs on your Cloudflare account, and even that server only ever stores ciphertext.",
	},
	{
		q: "What if I forget my master password?",
		a: "Nobody can reset it, not even an admin. It's the only key to your items. An admin can invite you again so you start over, which is why vauly asks you to print an Emergency Kit.",
	},
	{
		q: "What happens when someone leaves?",
		a: "Remove them and their copies of the vault keys are deleted. vauly then lists every item they could open, so you can change what matters.",
	},
	{
		q: "How is vauly different from 1Password or Bitwarden?",
		a: "1Password runs only in its own cloud, and hosting Bitwarden yourself means a server to look after. vauly runs on your own Cloudflare account with nothing to maintain, and it's free. They're older, with mobile apps, passkeys and audits vauly doesn't have yet. The docs compare all three.",
	},
	{
		q: "Can we move from 1Password or Bitwarden?",
		a: "Yes, and from a dozen others, browsers included. Choose Import from…, pick the app and drop in its export. One-time codes, notes and folders come along, and the file is read on your device. You can download a full backup any time, too.",
	},
	{
		q: "Has it been audited?",
		a: "Not yet. The design is small and documented, and every line of code is open to read.",
	},
];
