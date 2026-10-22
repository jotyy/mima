import type { Session } from "@mima/auth";
import type { Database } from "@mima/db";

export type Context = {
  session: Session | null;
  db: Database;
};
