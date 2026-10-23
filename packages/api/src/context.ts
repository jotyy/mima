import type { Auth, Session } from "@vauly/auth";
import type { Database } from "@vauly/db";

export type Context = {
	session: Session | null;
	db: Database;
	auth: Auth;
	headers: Headers;
	/** Server secret, used to derive decoy KDF salts for unknown emails. */
	secret: string;
	/**
	 * When set, creating the workspace takes this code, so a fresh deploy can't be
	 * claimed by whoever finds it first. It comes from the deploy's setup link.
	 */
	setupCode?: string;
};
