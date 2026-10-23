import { spawn } from "node:child_process";
import { hostname } from "node:os";

import {
	decodeAgentToken,
	importPrivateKey,
	openJson,
	unwrapKeyFrom,
} from "@vauly/crypto";

import { createMasker, type Field, type Reference } from "./references";

// What `vauly run` and `vauly mcp` share: the agent's token, its calls to the server, and
// getting each referenced item, with a person's approval when it's new.

export class CliError extends Error {}

/** Nobody approved in time. The request stays open, so a later run picks up the answer. */
export class ApprovalPending extends CliError {
	constructor(readonly count: number) {
		super("Nobody approved the request in time.");
	}
}

export type Config = ReturnType<typeof config>;

export function config(env: Record<string, string | undefined> = process.env) {
	const server = env.VAULY_SERVER?.replace(/\/$/, "");
	const token = env.VAULY_TOKEN;
	if (!server || !token) {
		throw new CliError(
			"Set VAULY_SERVER and VAULY_TOKEN (from the agent's page in vauly).",
		);
	}
	const decoded = decodeAgentToken(token);
	return { server, ...decoded };
}

export async function call<T>(
	cfg: Config,
	path: string,
	input: unknown,
): Promise<T> {
	const response = await fetch(`${cfg.server}/rpc/agent/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${cfg.agentId}.${cfg.secret}`,
			"x-vauly-host": hostname(),
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
		throw new CliError(message ?? `vauly answered ${response.status}.`);
	}
	return body?.json as T;
}

type Resolved =
	| { itemId: string; status: "granted"; data: string; wrappedKey: string }
	| { itemId: string; status: "pending"; requestId: string }
	| { itemId: string; status: "denied" | "missing" };

export type ItemFields = {
	name: string;
	secret?: string;
	username?: string;
	url?: string;
	notes?: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens every referenced item. New ones wait for a person to approve them in vauly, for
 * up to `timeoutMs`; `onWaiting` says once how many are waiting.
 */
export async function resolveAll(
	cfg: Config,
	refs: Reference[],
	command: string,
	{
		timeoutMs,
		onWaiting,
	}: {
		timeoutMs: number;
		onWaiting?: (count: number, agentName: string) => void;
	},
) {
	const me = await call<{ publicKey: string; name: string }>(
		cfg,
		"whoami",
		null,
	);
	const privateKey = await importPrivateKey(cfg.privateKeyRaw);
	const itemIds = [...new Set(refs.map((ref) => ref.itemId))];
	const values = new Map<string, ItemFields>();
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
				throw new CliError(`Access to ${result.itemId} was denied in vauly.`);
			} else {
				throw new CliError(`${result.itemId} doesn't exist or was deleted.`);
			}
		}
		if (pending.length === 0) continue;
		if (!announced) {
			onWaiting?.(pending.length, me.name);
			announced = true;
		}
		// Poll until every pending request is decided, then resolve again.
		for (;;) {
			if (Date.now() - started > timeoutMs) {
				throw new ApprovalPending(pending.length);
			}
			await wait(1500);
			const statuses = await call<{ id: string; status: string }[]>(
				cfg,
				"poll",
				{ requestIds: pending },
			);
			if (statuses.some((s) => s.status === "denied")) {
				throw new CliError("The request was denied in vauly.");
			}
			if (statuses.every((s) => s.status !== "pending")) break;
		}
	}
	return values;
}

export function pick(fields: ItemFields, field: Field) {
	const value = fields[field];
	if (value === undefined)
		throw new CliError(
			`${fields.name} has no ${field === "secret" ? "value" : field}.`,
		);
	return value;
}

/**
 * The environment for the command: each reference replaced by its value, and the token
 * left out. Also returns the values to mask in what the command prints.
 */
export function withValues(
	env: Record<string, string | undefined>,
	refs: Reference[],
	values: Map<string, ItemFields>,
) {
	const filled = { ...env };
	const secrets: string[] = [];
	for (const ref of refs) {
		const fields = values.get(ref.itemId);
		if (!fields) throw new CliError(`Couldn't open ${ref.itemId}.`);
		const value = pick(fields, ref.field);
		filled[ref.name] = value;
		if (ref.field === "secret") secrets.push(value);
	}
	delete filled.VAULY_TOKEN;
	return { env: filled, secrets };
}

/** Runs a shell command and collects what it prints, masked, keeping the last `limit` characters of each stream. */
export function capture(
	command: string,
	{
		env,
		secrets,
		cwd,
		timeoutMs,
		limit,
	}: {
		env: Record<string, string | undefined>;
		secrets: string[];
		cwd: string;
		timeoutMs: number;
		limit: number;
	},
) {
	return new Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
		timedOut: boolean;
	}>((resolve) => {
		const child = spawn(process.env.SHELL || "sh", ["-c", command], {
			env: env as NodeJS.ProcessEnv,
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const out = { stdout: "", stderr: "" };
		for (const name of ["stdout", "stderr"] as const) {
			const masker = createMasker(secrets);
			const stream = child[name];
			stream.setEncoding("utf8");
			const keep = (text: string) => {
				out[name] = (out[name] + text).slice(-limit);
			};
			stream.on("data", (chunk: string) => keep(masker.push(chunk)));
			stream.on("end", () => keep(masker.flush()));
		}
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutMs);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ exitCode: 127, stdout: "", stderr: error.message, timedOut });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ exitCode: code, ...out, timedOut });
		});
	});
}
