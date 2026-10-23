import { expect, test } from "bun:test";
import path from "node:path";
import { migrations } from "../src/bundled-migrations";
import { readMigrations } from "./read-migrations";

test("the bundled migrations match src/migrations (run `bun run db:generate` if not)", async () => {
	const onDisk = await readMigrations(
		path.join(import.meta.dirname, "../src/migrations"),
	);
	expect(migrations).toEqual(onDisk);
});
