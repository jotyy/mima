import type { Auth, Session } from "@mima/auth";
import type { Database } from "@mima/db";

export type Context = {
	session: Session | null;
	db: Database;
	auth: Auth;
	headers: Headers;
	/** Server secret, used to derive decoy KDF salts for unknown emails. */
	secret: string;
};
