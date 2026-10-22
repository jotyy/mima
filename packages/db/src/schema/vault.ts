import { sql } from "drizzle-orm";
import {
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { user } from "./auth";

// Everything named `encrypted*`, `wrapped*` or `data` is ciphertext produced by
// @mima/crypto on a client. The server can store and return it, never read it.

const createdAt = () =>
	integer("created_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.notNull();

export type Role = "owner" | "admin" | "member";

/** Workspace-wide plaintext settings, such as its name. */
export const setting = sqliteTable("setting", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
});

/** A person in the workspace, with the keys only their master password opens. */
export const member = sqliteTable("member", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	role: text("role").$type<Role>().notNull(),
	kdfSalt: text("kdf_salt").notNull(),
	kdfIterations: integer("kdf_iterations").notNull(),
	publicKey: text("public_key").notNull(),
	encryptedPrivateKey: text("encrypted_private_key").notNull(),
	lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
	createdAt: createdAt(),
});

export const invite = sqliteTable("invite", {
	id: text("id").primaryKey(),
	email: text("email").notNull(),
	role: text("role").$type<Exclude<Role, "owner">>().notNull(),
	tokenHash: text("token_hash").notNull().unique(),
	invitedBy: text("invited_by").notNull(),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
	acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
	createdAt: createdAt(),
});

export const vault = sqliteTable("vault", {
	id: text("id").primaryKey(),
	/** Sealed with the vault key: { name, description, tone }. */
	encryptedMeta: text("encrypted_meta").notNull(),
	/** Set for a person's private vault; nobody else can be added to it. */
	personalFor: text("personal_for"),
	createdBy: text("created_by").notNull(),
	createdAt: createdAt(),
});

/** Who can open a vault: the vault key wrapped to that person's public key. */
export const vaultAccess = sqliteTable(
	"vault_access",
	{
		vaultId: text("vault_id")
			.notNull()
			.references(() => vault.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => member.userId, { onDelete: "cascade" }),
		wrappedKey: text("wrapped_key").notNull(),
		grantedBy: text("granted_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.vaultId, table.userId] }),
		index("vault_access_user_idx").on(table.userId),
	],
);

export const item = sqliteTable(
	"item",
	{
		id: text("id").primaryKey(),
		vaultId: text("vault_id")
			.notNull()
			.references(() => vault.id, { onDelete: "cascade" }),
		/** The item key, wrapped with the vault key. */
		wrappedKey: text("wrapped_key").notNull(),
		/** Sealed with the item key: kind, name, username, secret, url, notes, … */
		data: text("data").notNull(),
		revision: integer("revision").notNull().default(1),
		createdBy: text("created_by").notNull(),
		updatedBy: text("updated_by").notNull(),
		createdAt: createdAt(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
		/** Set when moved to Recently deleted; the row is removed for good 30 days later. */
		deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
		deletedBy: text("deleted_by"),
	},
	(table) => [index("item_vault_idx").on(table.vaultId)],
);

export const favorite = sqliteTable(
	"favorite",
	{
		userId: text("user_id").notNull(),
		itemId: text("item_id")
			.notNull()
			.references(() => item.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.userId, table.itemId] })],
);

export type AgentKind = "mcp" | "cli" | "ci";

export const agent = sqliteTable("agent", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	kind: text("kind").$type<AgentKind>().notNull(),
	ownerId: text("owner_id").notNull(),
	publicKey: text("public_key").notNull(),
	secretHash: text("secret_hash").notNull(),
	enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
	host: text("host"),
	expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
	lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
	createdAt: createdAt(),
});

/** An item key wrapped to an agent's public key: the agent can decrypt that one item. */
export const agentGrant = sqliteTable(
	"agent_grant",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		itemId: text("item_id")
			.notNull()
			.references(() => item.id, { onDelete: "cascade" }),
		wrappedKey: text("wrapped_key").notNull(),
		/** `once` grants are removed after their first use. */
		once: integer("once", { mode: "boolean" }).notNull().default(false),
		expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
		grantedBy: text("granted_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		uniqueIndex("agent_grant_pair_idx").on(table.agentId, table.itemId),
	],
);

export type RequestStatus = "pending" | "approved" | "denied";

export const accessRequest = sqliteTable(
	"access_request",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id")
			.notNull()
			.references(() => agent.id, { onDelete: "cascade" }),
		itemId: text("item_id")
			.notNull()
			.references(() => item.id, { onDelete: "cascade" }),
		command: text("command").notNull(),
		status: text("status").$type<RequestStatus>().notNull().default("pending"),
		decidedBy: text("decided_by"),
		decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
		createdAt: createdAt(),
	},
	(table) => [index("access_request_status_idx").on(table.status)],
);

export type EventAction =
	| "created"
	| "updated"
	| "deleted"
	| "revealed"
	| "copied"
	| "injected"
	| "requested"
	| "approved"
	| "denied"
	| "granted"
	| "revoked"
	| "shared"
	| "joined"
	| "invited"
	| "imported"
	| "exported"
	| "restored"
	| "filled";

/** Append-only audit log. `detail` is plaintext: never put a secret in it. */
export const event = sqliteTable(
	"event",
	{
		id: text("id").primaryKey(),
		actorType: text("actor_type").$type<"member" | "agent">().notNull(),
		actorId: text("actor_id").notNull(),
		action: text("action").$type<EventAction>().notNull(),
		itemId: text("item_id"),
		vaultId: text("vault_id"),
		subjectId: text("subject_id"),
		detail: text("detail"),
		createdAt: createdAt(),
	},
	(table) => [index("event_created_idx").on(table.createdAt)],
);
