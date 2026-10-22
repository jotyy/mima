#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import {
	decodeAgentToken,
	importPrivateKey,
	openJson,
	unwrapKeyFrom,
} from "@mima/crypto";

import {
	createMasker,
	type Field,
	findReferences,
	parseEnvFile,
	type Reference,
} from "./references";

// mima run -- <command>: resolves mima:// references in the environment, waits for a
// person to approve new items, and starts the command with the values injected. The
// values never pass through the agent that called mima, and the command's output masks them.

const HELP = `mima — use secrets without seeing them

Usage:
  mima run [--env-file <path>] -- <command> [args...]
  mima whoami
  mima help

Environment:
  MIMA_SERVER   URL of your mima server
  MIMA_TOKEN    the agent token shown when the agent was created
  MIMA_APPROVAL_TIMEOUT   seconds to wait for approval (default 300)

Values like mima://itm_7k2m9qx4hc3r (or …/username) in the environment or the
env file are replaced by the item's value inside <command> only.`;

class CliError extends Error {}

function config() {
	const server = process.env.MIMA_SERVER?.replace(/\/$/, "");
	const token = process.env.MIMA_TOKEN;
	if (!server || !token) {
		throw new CliError(
			"Set MIMA_SERVER and MIMA_TOKEN (from the agent's page in mima).",
		);
	}
	const decoded = decodeAgentToken(token);
	return { server, ...decoded };
}

async function call<T>(
	cfg: ReturnType<typeof config>,
	path: string,
	input: unknown,
): Promise<T> {
	const response = await fetch(`${cfg.server}/rpc/agent/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${cfg.agentId}.${cfg.secret}`,
			"x-mima-host": hostname(),
		},
		body: JSON.stringify({ json: input }),
	}).catch(() => {
		throw new CliError(`Can't reach ${cfg.server}.`);
	});
	const body = (await response.json().catch(() => null)) as {
		json?: unknown;
	} | null;
	if (!response.ok) {
		const message = (body?.json as { message?: string } | undefined)?.message;
		throw new CliError(message ?? `mima answered ${response.status}.`);
	}
	return body?.json as T;
}

type Resolved =
	| { itemId: string; status: "granted"; data: string; wrappedKey: string }
	| { itemId: string; status: "pending"; requestId: string }
	| { itemId: string; status: "denied" | "missing" };

type ItemFields = {
	name: string;
	secret?: string;
	username?: string;
	url?: string;
	notes?: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function resolveAll(
	cfg: ReturnType<typeof config>,
	refs: Reference[],
	command: string,
) {
	const me = await call<{ publicKey: string; name: string }>(
		cfg,
		"whoami",
		null,
	);
	const privateKey = await importPrivateKey(cfg.privateKeyRaw);
	const itemIds = [...new Set(refs.map((ref) => ref.itemId))];
	const values = new Map<string, ItemFields>();
	const timeout = Number(process.env.MIMA_APPROVAL_TIMEOUT ?? 300) * 1000;
	const started = Date.now();
	let announced = false;

	while (values.size < itemIds.length) {
		const missing = itemIds.filter((id) => !values.has(id));
		const results = await call<Resolved[]>(cfg, "resolve", {
			itemIds: missing,
			command,
		});
		const pending: string[] = [];
		for (const result of results) {
			if (result.status === "granted") {
				const key = await unwrapKeyFrom(
					privateKey,
					me.publicKey,
					result.wrappedKey,
				);
				values.set(result.itemId, await openJson<ItemFields>(key, result.data));
			} else if (result.status === "pending") {
				pending.push(result.requestId);
			} else if (result.status === "denied") {
				throw new CliError(`Access to ${result.itemId} was denied in mima.`);
			} else {
				throw new CliError(`${result.itemId} doesn't exist or was deleted.`);
			}
		}
		if (pending.length === 0) continue;
		if (!announced) {
			process.stderr.write(
				`mima: ${me.name} needs approval for ${pending.length} ${pending.length === 1 ? "item" : "items"}. Approve it in mima under Needs you…\n`,
			);
			announced = true;
		}
		// Poll until every pending request is decided, then resolve again.
		for (;;) {
			if (Date.now() - started > timeout) {
				throw new CliError("Nobody approved the request in time.");
			}
			await wait(1500);
			const statuses = await call<{ id: string; status: string }[]>(
				cfg,
				"poll",
				{
					requestIds: pending,
				},
			);
			if (statuses.some((s) => s.status === "denied")) {
				throw new CliError("The request was denied in mima.");
			}
			if (statuses.every((s) => s.status !== "pending")) break;
		}
	}
	return values;
}

function pick(fields: ItemFields, field: Field) {
	const value = fields[field];
	if (value === undefined)
		throw new CliError(
			`${fields.name} has no ${field === "secret" ? "value" : field}.`,
		);
	return value;
}

async function run(args: string[]) {
	let envFile: string | undefined;
	const dash = args.indexOf("--");
	const options = dash === -1 ? [] : args.slice(0, dash);
	const commandArgs = dash === -1 ? args : args.slice(dash + 1);
	for (let i = 0; i < options.length; i++) {
		if (options[i] === "--env-file") envFile = options[++i];
	}
	if (commandArgs.length === 0)
		throw new CliError("Nothing to run. Usage: mima run -- <command>");

	const fileEnv = envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {};
	const env: Record<string, string | undefined> = {
		...fileEnv,
		...process.env,
	};
	const refs = findReferences(env);
	const command = commandArgs.join(" ").slice(0, 200);

	const secrets: string[] = [];
	if (refs.length > 0) {
		const cfg = config();
		const values = await resolveAll(cfg, refs, command);
		for (const ref of refs) {
			const fields = values.get(ref.itemId);
			if (!fields) throw new CliError(`Couldn't open ${ref.itemId}.`);
			const value = pick(fields, ref.field);
			env[ref.name] = value;
			if (ref.field === "secret") secrets.push(value);
		}
	}
	delete env.MIMA_TOKEN;

	const [bin, ...rest] = commandArgs as [string, ...string[]];
	const child = spawn(bin, rest, {
		env: env as NodeJS.ProcessEnv,
		stdio: ["inherit", "pipe", "pipe"],
	});
	for (const [stream, out] of [
		[child.stdout, process.stdout],
		[child.stderr, process.stderr],
	] as const) {
		const masker = createMasker(secrets);
		stream.setEncoding("utf8");
		stream.on("data", (chunk: string) => out.write(masker.push(chunk)));
		stream.on("end", () => out.write(masker.flush()));
	}
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => child.kill(signal));
	}
	child.on("error", (error) => {
		process.stderr.write(`mima: couldn't start ${bin}: ${error.message}\n`);
		process.exit(127);
	});
	child.on("close", (code) => process.exit(code ?? 1));
}

async function main() {
	const [command, ...args] = process.argv.slice(2);
	if (
		!command ||
		command === "help" ||
		command === "--help" ||
		command === "-h"
	) {
		console.log(HELP);
		return;
	}
	if (command === "whoami") {
		const cfg = config();
		const me = await call<{ id: string; name: string }>(cfg, "whoami", null);
		console.log(`${me.name} (${me.id}) on ${cfg.server}`);
		return;
	}
	if (command === "run") return run(args);
	throw new CliError(`Unknown command "${command}". Run mima help.`);
}

main().catch((error) => {
	process.stderr.write(
		`mima: ${error instanceof CliError ? error.message : String(error)}\n`,
	);
	process.exit(1);
});
