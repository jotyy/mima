import type { Database } from "@mima/db";
import {
	type EventAction,
	event,
	item,
	vaultAccess,
} from "@mima/db/schema/vault";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";

/** `itm_7k2m9qx4hc3r`: short, prefixed, unguessable. */
export function newId(prefix: string) {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return `${prefix}_${Array.from(bytes, (b) => alphabet[b % 32]).join("")}`;
}

export async function hashToken(token: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export async function myVaultIds(db: Database, userId: string) {
	const rows = await db
		.select({ vaultId: vaultAccess.vaultId })
		.from(vaultAccess)
		.where(eq(vaultAccess.userId, userId));
	return rows.map((row) => row.vaultId);
}

export async function requireVaultAccess(
	db: Database,
	userId: string,
	vaultId: string,
) {
	const [row] = await db
		.select()
		.from(vaultAccess)
		.where(
			and(eq(vaultAccess.userId, userId), eq(vaultAccess.vaultId, vaultId)),
		);
	if (!row) throw new ORPCError("NOT_FOUND", { message: "Vault not found" });
	return row;
}

export async function requireItemAccess(
	db: Database,
	userId: string,
	itemId: string,
) {
	const [row] = await db.select().from(item).where(eq(item.id, itemId));
	if (!row) throw new ORPCError("NOT_FOUND", { message: "Item not found" });
	await requireVaultAccess(db, userId, row.vaultId);
	return row;
}

export async function accessibleItemIds(db: Database, userId: string) {
	const vaultIds = await myVaultIds(db, userId);
	if (vaultIds.length === 0) return [];
	const rows = await db
		.select({ id: item.id })
		.from(item)
		.where(inArray(item.vaultId, vaultIds));
	return rows.map((row) => row.id);
}

export function logEvent(
	db: Database,
	entry: {
		actorType: "member" | "agent";
		actorId: string;
		action: EventAction;
		itemId?: string | null;
		vaultId?: string | null;
		subjectId?: string | null;
		detail?: string | null;
	},
) {
	return db.insert(event).values({ id: newId("evt"), ...entry });
}
