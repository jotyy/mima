import type { Database } from "@vauly/db";
import { account, session, user, verification } from "@vauly/db/schema/auth";
import {
	accessRequest,
	agent,
	agentGrant,
	event,
	favorite,
	invite,
	item,
	member,
	setting,
	vault,
	vaultAccess,
} from "@vauly/db/schema/vault";

/**
 * Empties every table so each e2e run starts from a fresh workspace. Mounted only when the
 * stack was started with E2E_RESET_TOKEN, which `bun run dev` and deploys never set.
 */
export async function resetDatabase(db: Database) {
	await db.batch([
		db.delete(event),
		db.delete(accessRequest),
		db.delete(agentGrant),
		db.delete(agent),
		db.delete(favorite),
		db.delete(item),
		db.delete(vaultAccess),
		db.delete(vault),
		db.delete(invite),
		db.delete(member),
		db.delete(setting),
		db.delete(session),
		db.delete(account),
		db.delete(verification),
		db.delete(user),
	]);
}
