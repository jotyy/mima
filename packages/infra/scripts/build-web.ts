// Builds apps/web the way `alchemy deploy` does for the production and demo stacks
// (Cloudflare.Website.Vite in alchemy.run.ts): with Alchemy's own build function, which
// injects its Cloudflare Vite plugin and passes the stage's VITE_* settings as defines.
// The app lands in apps/web/dist/client. With a manifest from `bun run build` given, it
// checks the two builds serve the same files, byte for byte: `vauly verify` rebuilds
// that way, so a deploy from Alchemy has to match it. CI runs it.
//
//   VITE_SERVER_URL=https://api.example.test bun scripts/build-web.ts [vauly-build.json]

import { readFileSync } from "node:fs";
import path from "node:path";

import * as BunServices from "@effect/platform-bun/BunServices";
import { viteBuildInProcess } from "alchemy/Cloudflare/Workers/Sources/Vite";
import * as Effect from "effect/Effect";

const root = path.resolve(import.meta.dir, "../../../apps/web");
const compareWith = process.argv[2] && path.resolve(process.argv[2]);
process.chdir(root);
await Effect.runPromise(
	viteBuildInProcess(
		root,
		{
			VITE_SERVER_URL: process.env.VITE_SERVER_URL ?? "",
			VITE_DEMO_EMAIL: process.env.VAULY_DEMO_EMAIL ?? "",
			VITE_DEMO_PASSWORD: process.env.VAULY_DEMO_PASSWORD ?? "",
		},
		{ compatibilityDate: "2026-10-01", compatibilityFlags: ["nodejs_compat"] },
	).pipe(Effect.provide(BunServices.layer)),
);
const built = path.join(root, "dist/client/.well-known/vauly-build.json");
console.log(`Built ${path.dirname(path.dirname(built))}`);

if (compareWith) {
	type Manifest = { files: Record<string, string> };
	const read = (file: string): Manifest =>
		JSON.parse(readFileSync(file, "utf8"));
	const alchemy = read(built).files;
	const plain = read(compareWith).files;
	const differ = [...new Set([...Object.keys(alchemy), ...Object.keys(plain)])]
		.filter((file) => alchemy[file] !== plain[file])
		.sort();
	if (differ.length > 0) {
		console.error(
			`The Alchemy build and the plain build differ in ${differ.length} files:\n  ${differ.join("\n  ")}`,
		);
		process.exit(1);
	}
	console.log(
		`Same ${Object.keys(plain).length} files as ${path.relative(process.cwd(), compareWith)}.`,
	);
}
