// Fake data for the prototype screens. Nothing here is a real account, person or secret;
// it goes away once the pages read from the API.

export type ItemKind = "login" | "api-key" | "note" | "ssh-key";
export type Tone = "blue" | "teal" | "amber" | "violet";

export interface Member {
	id: string;
	name: string;
	email: string;
	role: "Owner" | "Admin" | "Member";
	lastActiveMin: number;
	invited?: boolean;
	invitedMin?: number;
}

export interface Vault {
	id: string;
	name: string;
	slug: string;
	description: string;
	tone: Tone;
	memberIds: string[];
}

export interface Item {
	id: string;
	kind: ItemKind;
	name: string;
	slug: string;
	vaultId: string;
	username?: string;
	secret?: string;
	url?: string;
	totp?: boolean;
	notes?: string;
	tags: string[];
	updatedMin: number;
	updatedBy: string;
	strength?: "strong" | "fair" | "weak";
	// Minutes since you last copied or revealed it.
	usedMin?: number;
	favorite?: boolean;
}

export interface Agent {
	id: string;
	name: string;
	kind: "MCP" | "CLI" | "CI";
	host: string;
	ownerId: string;
	itemIds: string[];
	expiresInDays: number | null;
	lastSeenMin: number;
	runsThisWeek: number;
	enabled: boolean;
}

export interface ApprovalRequest {
	id: string;
	agentId: string;
	itemId: string;
	command: string;
	requestedMin: number;
}

export type Actor = { kind: "member" | "agent"; id: string };

export interface ActivityEvent {
	id: string;
	min: number;
	actor: Actor;
	action:
		| "revealed"
		| "copied"
		| "injected"
		| "approved"
		| "denied"
		| "created"
		| "updated"
		| "shared";
	itemId: string;
	detail?: string;
}

export const workspace = { name: "Acme", plan: "Self-hosted" };
export const currentMemberId = "m-alex";

export const members: Member[] = [
	{
		id: "m-alex",
		name: "Alex Kim",
		email: "alex@acme.example",
		role: "Owner",
		lastActiveMin: 0,
	},
	{
		id: "m-mei",
		name: "Mei Chen",
		email: "mei@acme.example",
		role: "Admin",
		lastActiveMin: 38,
	},
	{
		id: "m-sam",
		name: "Sam Ortiz",
		email: "sam@acme.example",
		role: "Member",
		lastActiveMin: 260,
	},
	{
		id: "m-ada",
		name: "Ada Park",
		email: "ada@acme.example",
		role: "Member",
		lastActiveMin: 2880,
	},
	{
		id: "m-leo",
		name: "Leo Wang",
		email: "leo@acme.example",
		role: "Member",
		lastActiveMin: 0,
		invited: true,
		invitedMin: 4320,
	},
];

export const vaults: Vault[] = [
	{
		id: "v-private",
		name: "Private",
		slug: "private",
		description: "Only you can open this vault.",
		tone: "violet",
		memberIds: ["m-alex"],
	},
	{
		id: "v-eng",
		name: "Engineering",
		slug: "engineering",
		description: "Databases, cloud accounts and API keys for the product.",
		tone: "blue",
		memberIds: ["m-alex", "m-mei", "m-sam"],
	},
	{
		id: "v-ops",
		name: "Operations",
		slug: "operations",
		description: "Billing, domains and the shared support inbox.",
		tone: "teal",
		memberIds: ["m-alex", "m-mei", "m-ada"],
	},
	{
		id: "v-design",
		name: "Design",
		slug: "design",
		description: "Tools and fonts the design team shares.",
		tone: "amber",
		memberIds: ["m-alex", "m-ada"],
	},
];

export const items: Item[] = [
	{
		id: "i-github",
		usedMin: 9,
		favorite: true,
		kind: "login",
		name: "GitHub",
		slug: "github",
		vaultId: "v-eng",
		username: "acme-bot",
		secret: "Vq7#mPz2!rLw9xKe",
		url: "https://github.com/login",
		totp: true,
		tags: ["source"],
		updatedMin: 140,
		updatedBy: "m-mei",
		strength: "strong",
	},
	{
		id: "i-pg-staging",
		usedMin: 34,
		favorite: true,
		kind: "api-key",
		name: "Postgres · staging",
		slug: "postgres-staging",
		vaultId: "v-eng",
		username: "app_staging",
		secret:
			"postgres://app_staging:example-not-real@db.staging.acme.example:5432/app",
		notes: "Read-write. Rotated every 90 days by the deploy job.",
		tags: ["database", "staging"],
		updatedMin: 1440,
		updatedBy: "m-sam",
		strength: "strong",
	},
	{
		id: "i-cloudflare",
		usedMin: 180,
		kind: "login",
		name: "Cloudflare",
		slug: "cloudflare",
		vaultId: "v-eng",
		username: "ops@acme.example",
		secret: "cloud-Kite-48-ember",
		url: "https://dash.cloudflare.com",
		totp: true,
		tags: ["infra"],
		updatedMin: 4320,
		updatedBy: "m-alex",
		strength: "fair",
	},
	{
		id: "i-cf-token",
		usedMin: 60,
		kind: "api-key",
		name: "Cloudflare deploy token",
		slug: "cloudflare-deploy-token",
		vaultId: "v-eng",
		secret: "example-token-0f3a9c7e2b4d6a81",
		notes: "Workers: edit. D1: edit. Nothing else.",
		tags: ["deploy"],
		updatedMin: 10080,
		updatedBy: "m-alex",
		strength: "strong",
	},
	{
		id: "i-stripe",
		usedMin: 1500,
		kind: "api-key",
		name: "Stripe test key",
		slug: "stripe-test-key",
		vaultId: "v-ops",
		secret: "example-stripe-test-7c21d9",
		tags: ["billing", "test"],
		updatedMin: 2880,
		updatedBy: "m-mei",
		strength: "strong",
	},
	{
		id: "i-linear",
		kind: "login",
		name: "Linear",
		slug: "linear",
		vaultId: "v-eng",
		username: "alex@acme.example",
		secret: "linear123",
		url: "https://linear.app/login",
		tags: [],
		updatedMin: 43200,
		updatedBy: "m-alex",
		strength: "weak",
	},
	{
		id: "i-support",
		usedMin: 95,
		favorite: true,
		kind: "login",
		name: "Support inbox",
		slug: "support-inbox",
		vaultId: "v-ops",
		username: "support@acme.example",
		secret: "Harbor-Lantern-61",
		url: "https://mail.acme.example",
		tags: ["shared"],
		updatedMin: 8640,
		updatedBy: "m-ada",
		strength: "fair",
	},
	{
		id: "i-domains",
		kind: "login",
		name: "Domain registrar",
		slug: "domain-registrar",
		vaultId: "v-ops",
		username: "acme-admin",
		secret: "domains2024",
		url: "https://registrar.example",
		totp: true,
		tags: ["dns"],
		updatedMin: 64800,
		updatedBy: "m-mei",
		strength: "weak",
	},
	{
		id: "i-figma",
		usedMin: 2900,
		kind: "login",
		name: "Figma",
		slug: "figma",
		vaultId: "v-design",
		username: "design@acme.example",
		secret: "Pixel-Orbit-22-tide",
		url: "https://www.figma.com/login",
		tags: [],
		updatedMin: 20160,
		updatedBy: "m-ada",
		strength: "strong",
	},
	{
		id: "i-fonts",
		kind: "note",
		name: "Font licenses",
		slug: "font-licenses",
		vaultId: "v-design",
		notes:
			"Desktop licenses for 6 seats. Web licenses cover acme.example and the docs site.",
		tags: ["licenses"],
		updatedMin: 86400,
		updatedBy: "m-ada",
	},
	{
		id: "i-deploy-ssh",
		kind: "ssh-key",
		name: "Deploy SSH key",
		slug: "deploy-ssh-key",
		vaultId: "v-eng",
		username: "deploy",
		secret: "-----BEGIN OPENSSH PRIVATE KEY----- (example, not a real key)",
		notes: "Fingerprint SHA256:example0000000000000000",
		tags: ["deploy"],
		updatedMin: 129600,
		updatedBy: "m-sam",
	},
	{
		id: "i-wifi",
		usedMin: 4300,
		kind: "note",
		name: "Office Wi-Fi",
		slug: "office-wifi",
		vaultId: "v-private",
		notes: "Network: acme-guest. Password on the card by the door.",
		tags: [],
		updatedMin: 7200,
		updatedBy: "m-alex",
	},
];

export const agents: Agent[] = [
	{
		id: "a-claude",
		name: "Claude Code",
		kind: "MCP",
		host: "alex-macbook",
		ownerId: "m-alex",
		itemIds: ["i-pg-staging", "i-cf-token", "i-stripe"],
		expiresInDays: 7,
		lastSeenMin: 4,
		runsThisWeek: 86,
		enabled: true,
	},
	{
		id: "a-actions",
		name: "GitHub Actions",
		kind: "CI",
		host: "acme/web · deploy.yml",
		ownerId: "m-mei",
		itemIds: ["i-cf-token", "i-deploy-ssh"],
		expiresInDays: null,
		lastSeenMin: 52,
		runsThisWeek: 31,
		enabled: true,
	},
	{
		id: "a-cursor",
		name: "Cursor",
		kind: "MCP",
		host: "sam-thinkpad",
		ownerId: "m-sam",
		itemIds: ["i-pg-staging"],
		expiresInDays: 2,
		lastSeenMin: 1500,
		runsThisWeek: 11,
		enabled: true,
	},
	{
		id: "a-backup",
		name: "Backup job",
		kind: "CLI",
		host: "ops-runner-1",
		ownerId: "m-mei",
		itemIds: ["i-pg-staging"],
		expiresInDays: 30,
		lastSeenMin: 20160,
		runsThisWeek: 0,
		enabled: false,
	},
];

export const approvalRequests: ApprovalRequest[] = [
	{
		id: "r-1",
		agentId: "a-claude",
		itemId: "i-pg-staging",
		command: "bun run db:migrate",
		requestedMin: 4,
	},
	{
		id: "r-2",
		agentId: "a-cursor",
		itemId: "i-stripe",
		command: "bun test billing",
		requestedMin: 19,
	},
];

export const activity: ActivityEvent[] = [
	{
		id: "e-1",
		min: 4,
		actor: { kind: "agent", id: "a-claude" },
		action: "injected",
		itemId: "i-cf-token",
		detail: "wrangler deploy",
	},
	{
		id: "e-2",
		min: 11,
		actor: { kind: "member", id: "m-alex" },
		action: "approved",
		itemId: "i-cf-token",
		detail: "Claude Code, for 1 hour",
	},
	{
		id: "e-3",
		min: 26,
		actor: { kind: "member", id: "m-mei" },
		action: "copied",
		itemId: "i-github",
		detail: "one-time code",
	},
	{
		id: "e-4",
		min: 52,
		actor: { kind: "agent", id: "a-actions" },
		action: "injected",
		itemId: "i-deploy-ssh",
		detail: "deploy.yml",
	},
	{
		id: "e-5",
		min: 95,
		actor: { kind: "member", id: "m-sam" },
		action: "revealed",
		itemId: "i-pg-staging",
	},
	{
		id: "e-6",
		min: 140,
		actor: { kind: "member", id: "m-mei" },
		action: "updated",
		itemId: "i-github",
		detail: "password",
	},
	{
		id: "e-7",
		min: 300,
		actor: { kind: "member", id: "m-alex" },
		action: "denied",
		itemId: "i-stripe",
		detail: "Cursor",
	},
	{
		id: "e-8",
		min: 1440,
		actor: { kind: "member", id: "m-sam" },
		action: "created",
		itemId: "i-pg-staging",
	},
	{
		id: "e-9",
		min: 1500,
		actor: { kind: "agent", id: "a-cursor" },
		action: "injected",
		itemId: "i-pg-staging",
		detail: "bun run dev",
	},
	{
		id: "e-10",
		min: 2880,
		actor: { kind: "member", id: "m-mei" },
		action: "shared",
		itemId: "i-stripe",
		detail: "Operations",
	},
];

export const findItem = (id: string) => items.find((item) => item.id === id);
export const findVault = (id: string) =>
	vaults.find((vault) => vault.id === id);
export const findMember = (id: string) =>
	members.find((member) => member.id === id);
export const findAgent = (id: string) =>
	agents.find((agent) => agent.id === id);

export const itemReference = (item: Item) => {
	const vault = findVault(item.vaultId);
	return `mima://${vault?.slug ?? "vault"}/${item.slug}`;
};

// A stand-in for a real TOTP: six digits that change every 30 seconds.
export function fakeOneTimeCode(seed: string, slot: number) {
	let hash = slot;
	for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
	return String(hash % 1_000_000).padStart(6, "0");
}
