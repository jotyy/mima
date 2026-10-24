import { afterEach, expect, test } from "bun:test";
import { KdfError } from "@vauly/crypto";

import { unlock } from "./vault";

// The extension checks the key derivation settings a server sends before the master
// password goes into them, and refuses PBKDF2 for an account it has seen use Argon2id.

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const PBKDF2 = {
	kdfSalt: SALT,
	kdf: "pbkdf2",
	kdfIterations: 600_000,
	kdfPasses: null,
	kdfMemory: null,
};

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

/** A server that answers prelogin with these settings, and notes any sign-in. */
function server(settings: object) {
	const signIns: string[] = [];
	const running = Bun.serve({
		port: 0,
		fetch(request) {
			const { pathname } = new URL(request.url);
			if (pathname === "/rpc/account/prelogin") {
				return Response.json({ json: settings });
			}
			signIns.push(pathname);
			return new Response("Not found", { status: 404 });
		},
	});
	servers.push(running);
	return { url: `http://localhost:${running.port}`, signIns };
}

test("settings weaker than vauly allows are refused before the password goes in", async () => {
	for (const settings of [
		{ ...PBKDF2, kdfIterations: 1_000 },
		{ ...PBKDF2, kdf: "argon2id", kdfPasses: 1, kdfMemory: 65_536 },
		{ ...PBKDF2, kdf: "argon2id", kdfPasses: 3, kdfMemory: 1024 },
		{ ...PBKDF2, kdfSalt: "AAAAAAAAAAAAAAAA" },
	]) {
		const { url, signIns } = server(settings);
		await expect(
			unlock(
				{ server: url, email: "alex@acme.test" },
				"a long master password",
			),
		).rejects.toThrow(KdfError);
		expect(signIns).toEqual([]);
	}
});

test("PBKDF2 is refused for an account this extension has seen use Argon2id", async () => {
	const { url, signIns } = server(PBKDF2);
	await expect(
		unlock(
			{ server: url, email: "alex@acme.test" },
			"a long master password",
			undefined,
			true,
		),
	).rejects.toThrow("now asks for older key derivation");
	expect(signIns).toEqual([]);
});
