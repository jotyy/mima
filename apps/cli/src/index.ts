#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

import {
	ApprovalPending,
	CliError,
	call,
	config,
	resolveAll,
	withValues,
} from "./agent";
import { serve } from "./mcp";
import { createMasker, findReferences, parseEnvFile } from "./references";

// vauly run -- <command>: resolves vauly:// references in the environment, waits for a
// person to approve new items, and starts the command with the values injected. The
// values never pass through the agent that called vauly, and the command's output masks them.

const HELP = `vauly — use secrets without seeing them

Usage:
  vauly run [--env-file <path>] -- <command> [args...]
  vauly mcp        an MCP server for coding agents, on stdin and stdout
  vauly whoami
  vauly help

Environment:
  VAULY_SERVER   URL of your vauly server
  VAULY_TOKEN    the agent token shown when the agent was created
  VAULY_APPROVAL_TIMEOUT   seconds to wait for approval (default 300)

Values like vauly://itm_7k2m9qx4hc3r (or …/username) in the environment or the
env file are replaced by the item's value inside <command> only.`;

async function run(args: string[]) {
	let envFile: string | undefined;
	const dash = args.indexOf("--");
	const options = dash === -1 ? [] : args.slice(0, dash);
	const commandArgs = dash === -1 ? args : args.slice(dash + 1);
	for (let i = 0; i < options.length; i++) {
		if (options[i] === "--env-file") envFile = options[++i];
	}
	if (commandArgs.length === 0)
		throw new CliError("Nothing to run. Usage: vauly run -- <command>");

	const fileEnv = envFile ? parseEnvFile(readFileSync(envFile, "utf8")) : {};
	const env: Record<string, string | undefined> = {
		...fileEnv,
		...process.env,
	};
	const refs = findReferences(env);
	const command = commandArgs.join(" ").slice(0, 200);

	let secrets: string[] = [];
	let filled: Record<string, string | undefined> = { ...env };
	delete filled.VAULY_TOKEN;
	if (refs.length > 0) {
		const values = await resolveAll(config(), refs, command, {
			timeoutMs: Number(process.env.VAULY_APPROVAL_TIMEOUT ?? 300) * 1000,
			onWaiting: (count, agent) =>
				process.stderr.write(
					`vauly: ${agent} needs approval for ${count} ${count === 1 ? "item" : "items"}. Approve it in vauly under Needs you…\n`,
				),
		}).catch((error) => {
			throw error instanceof ApprovalPending
				? new CliError("Nobody approved the request in time.")
				: error;
		});
		({ env: filled, secrets } = withValues(env, refs, values));
	}

	const [bin, ...rest] = commandArgs as [string, ...string[]];
	const child = spawn(bin, rest, {
		env: filled as NodeJS.ProcessEnv,
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
		process.stderr.write(`vauly: couldn't start ${bin}: ${error.message}\n`);
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
	if (command === "mcp") return serve();
	throw new CliError(`Unknown command "${command}". Run vauly help.`);
}

main().catch((error) => {
	process.stderr.write(
		`vauly: ${error instanceof CliError ? error.message : String(error)}\n`,
	);
	process.exit(1);
});
