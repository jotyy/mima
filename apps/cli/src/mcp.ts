import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline";

import { version } from "../package.json";
import {
	ApprovalPending,
	CliError,
	type Config,
	call,
	capture,
	config,
	resolveAll,
	withValues,
} from "./agent";
import {
	findReferences,
	parseEnvFile,
	parseReference,
	type Reference,
} from "./references";

// vauly mcp: a Model Context Protocol server on stdin and stdout, for coding agents. It is
// the same agent as `vauly run`, with the same token, grants and approvals. No tool hands
// a value to the model: list_secrets shows what's there, run_with_secrets uses it inside
// a command whose output is masked, and request_access asks a person first.

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Each stream keeps this much of the end of what a command prints. */
const OUTPUT_LIMIT = 20_000;

type Message = {
	jsonrpc: "2.0";
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: { code: number; message: string };
};

type ToolResult = {
	content: { type: "text"; text: string }[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

const text = (
	body: string,
	structured?: Record<string, unknown>,
	isError?: boolean,
): ToolResult => ({
	content: [{ type: "text", text: body }],
	...(structured && { structuredContent: structured }),
	...(isError && { isError }),
});

const envInput = {
	envFile: {
		type: "string",
		description:
			"The env file whose vauly:// references to use, relative to the project. Defaults to .env when there is one.",
	},
	env: {
		type: "object",
		additionalProperties: { type: "string" },
		description:
			'More variables, such as {"STRIPE_KEY": "vauly://itm_3f8w2kq9xm1t"}.',
	},
	cwd: {
		type: "string",
		description:
			"The directory to work in, relative to the project. Defaults to the project.",
	},
} as const;

export const tools = [
	{
		name: "list_secrets",
		title: "List secrets",
		description:
			"List the secrets this project can use through vauly: each environment variable in the env file (or in `env`) whose value is a vauly:// reference, and whether this agent may use that item yet or a person has to approve it first. Never returns secret values or item names. Run a command with them using run_with_secrets.",
		inputSchema: {
			type: "object",
			properties: envInput,
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true, openWorldHint: false },
	},
	{
		name: "run_with_secrets",
		title: "Run a command with secrets",
		description:
			"Run a shell command with secrets from vauly in its environment. Every variable in the env file (or in `env`) whose value is a vauly:// reference holds the item's value inside the command only. You get the exit code and the output, with each secret shown as <hidden>: the values never reach you. The first time this agent uses an item, a person approves it in vauly; this waits for them for a while, then returns without running so you can ask them and call it again.",
		inputSchema: {
			type: "object",
			properties: {
				command: {
					type: "string",
					description:
						"The shell command, such as `npm test` or `./scripts/migrate.sh`.",
				},
				...envInput,
				timeoutSeconds: {
					type: "number",
					minimum: 1,
					maximum: 3600,
					description: "Stops the command after this long. Defaults to 300.",
				},
			},
			required: ["command"],
			additionalProperties: false,
		},
		annotations: { destructiveHint: true, openWorldHint: true },
	},
	{
		name: "request_access",
		title: "Ask for access",
		description:
			"Ask a person in vauly to let this agent use items, with a reason they read when they approve. Nothing runs and no value comes back. Use it when list_secrets shows that an item needs approval and you'd rather ask before running something.",
		inputSchema: {
			type: "object",
			properties: {
				references: {
					type: "array",
					items: { type: "string" },
					minItems: 1,
					description:
						"vauly:// references, or names of variables in the env file that hold one.",
				},
				reason: {
					type: "string",
					description:
						"What you need them for, in a sentence the person will read, such as `Run the database migrations`.",
				},
				envFile: envInput.envFile,
				cwd: envInput.cwd,
			},
			required: ["references", "reason"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: false, openWorldHint: true },
	},
] as const;

type Status =
	| {
			itemId: string;
			status: "granted";
			once?: boolean;
			expiresAt?: string | null;
	  }
	| { itemId: string; status: "pending"; requestId: string }
	| { itemId: string; status: "denied" | "none" | "missing" };

function describe(status: Status | undefined) {
	switch (status?.status) {
		case "granted":
			return status.once
				? "ready for one run"
				: status.expiresAt
					? `ready until ${new Date(status.expiresAt).toISOString()}`
					: "ready until revoked";
		case "pending":
			return "waiting for a person to approve it in vauly";
		case "denied":
			return "denied in vauly; ask your person why";
		case "missing":
			return "not found: deleted, or a wrong reference";
		default:
			return "needs approval: run_with_secrets or request_access asks a person in vauly";
	}
}

const label: Record<Status["status"], string> = {
	granted: "ready",
	pending: "waiting_for_approval",
	denied: "denied",
	none: "needs_approval",
	missing: "not_found",
};

export type Context = {
	/** The project: where the client started `vauly mcp`. */
	cwd: string;
	env: Record<string, string | undefined>;
	/** How long run_with_secrets waits for an approval before it returns. */
	approvalWaitMs: number;
	progress?: (message: string, elapsedSeconds: number) => void;
};

function project(context: Context, args: Record<string, unknown>) {
	const cwd =
		typeof args.cwd === "string"
			? resolvePath(context.cwd, args.cwd)
			: context.cwd;
	const named = typeof args.envFile === "string" ? args.envFile : undefined;
	const envPath = resolvePath(cwd, named ?? ".env");
	if (named && !existsSync(envPath)) {
		throw new CliError(`There's no env file at ${named}.`);
	}
	const fileEnv = existsSync(envPath)
		? parseEnvFile(readFileSync(envPath, "utf8"))
		: {};
	const extra =
		args.env && typeof args.env === "object"
			? Object.fromEntries(
					Object.entries(args.env).filter(
						(entry): entry is [string, string] => typeof entry[1] === "string",
					),
				)
			: {};
	const declared = { ...fileEnv, ...extra };
	return {
		cwd,
		declared,
		refs: findReferences(declared),
		env: { ...context.env, ...declared },
	};
}

async function statuses(cfg: Config, refs: Reference[]) {
	const itemIds = [...new Set(refs.map((ref) => ref.itemId))];
	if (itemIds.length === 0) return new Map<string, Status>();
	const found = await call<Status[]>(cfg, "status", { itemIds });
	return new Map(found.map((status) => [status.itemId, status]));
}

const noReferences =
	"There are no vauly:// references in the env file or in `env`. Ask your person for the reference of the item you need (in vauly: the item's … menu, then Use with an agent…) and put it in .env, such as DATABASE_URL=vauly://itm_7k2m9qx4hc3r.";

async function listSecrets(context: Context, args: Record<string, unknown>) {
	const { refs } = project(context, args);
	if (refs.length === 0) return text(noReferences, { secrets: [] });
	const cfg = config(context.env);
	const [me, found] = await Promise.all([
		call<{ name: string }>(cfg, "whoami", null),
		statuses(cfg, refs),
	]);
	const secrets = refs.map((ref) => {
		const status = found.get(ref.itemId);
		return {
			name: ref.name,
			reference: `vauly://${ref.itemId}${ref.field === "secret" ? "" : `/${ref.field}`}`,
			status: label[status?.status ?? "none"],
			detail: describe(status),
		};
	});
	const lines = secrets.map(
		(secret) => `${secret.name} = ${secret.reference}: ${secret.detail}`,
	);
	return text(`As the vauly agent "${me.name}":\n${lines.join("\n")}`, {
		agent: me.name,
		secrets,
	});
}

async function runWithSecrets(context: Context, args: Record<string, unknown>) {
	if (typeof args.command !== "string" || !args.command.trim()) {
		throw new CliError("Say which command to run.");
	}
	const command = args.command;
	const { cwd, env, refs } = project(context, args);
	let filled: Record<string, string | undefined> = { ...env };
	delete filled.VAULY_TOKEN;
	let secrets: string[] = [];
	if (refs.length > 0) {
		const started = Date.now();
		let ticker: ReturnType<typeof setInterval> | undefined;
		try {
			const values = await resolveAll(
				config(context.env),
				refs,
				command.slice(0, 200),
				{
					timeoutMs: context.approvalWaitMs,
					onWaiting: (count, agent) => {
						const message = `${agent} is waiting for a person to approve ${count === 1 ? "an item" : `${count} items`} in vauly`;
						context.progress?.(message, 0);
						ticker = setInterval(
							() =>
								context.progress?.(
									message,
									Math.round((Date.now() - started) / 1000),
								),
							5000,
						);
					},
				},
			);
			({ env: filled, secrets } = withValues(env, refs, values));
		} catch (error) {
			if (error instanceof ApprovalPending) {
				return text(
					`Not run yet: ${error.count === 1 ? "an item needs" : `${error.count} items need`} a person's approval in vauly. Ask them to approve it under Needs you on vauly's Overview, then call run_with_secrets again. The request stays open until they answer.`,
					{ status: "waiting_for_approval", items: error.count },
					true,
				);
			}
			throw error;
		} finally {
			clearInterval(ticker);
		}
	}
	const timeout =
		typeof args.timeoutSeconds === "number"
			? Math.min(Math.max(args.timeoutSeconds, 1), 3600)
			: 300;
	const result = await capture(command, {
		env: filled,
		secrets,
		cwd,
		timeoutMs: timeout * 1000,
		limit: OUTPUT_LIMIT,
	});
	const summary = result.timedOut
		? `Stopped after ${timeout} seconds.`
		: `Exit code ${result.exitCode}.`;
	return text(
		[
			summary,
			result.stdout && `stdout:\n${result.stdout}`,
			result.stderr && `stderr:\n${result.stderr}`,
		]
			.filter(Boolean)
			.join("\n\n"),
		{
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			stdout: result.stdout,
			stderr: result.stderr,
		},
		result.exitCode !== 0,
	);
}

async function requestAccess(context: Context, args: Record<string, unknown>) {
	const reason = typeof args.reason === "string" ? args.reason.trim() : "";
	if (!reason) throw new CliError("Give a reason the person will read.");
	const asked = Array.isArray(args.references) ? args.references : [];
	const { declared } = project(context, args);
	const itemIds = asked.map((entry) => {
		const value = String(entry);
		const ref = parseReference(value) ?? parseReference(declared[value] ?? "");
		if (!ref) {
			throw new CliError(
				`${value} is neither a vauly:// reference nor a variable that holds one.`,
			);
		}
		return ref.itemId;
	});
	if (itemIds.length === 0) throw new CliError("Say which items to ask for.");
	const found = await call<Status[]>(config(context.env), "request", {
		itemIds,
		reason: reason.slice(0, 200),
	});
	const lines = found.map(
		(status) => `vauly://${status.itemId}: ${describe(status)}`,
	);
	return text(lines.join("\n"), {
		items: found.map((status) => ({
			reference: `vauly://${status.itemId}`,
			status: label[status.status],
		})),
	});
}

const handlers: Record<
	(typeof tools)[number]["name"],
	(context: Context, args: Record<string, unknown>) => Promise<ToolResult>
> = {
	list_secrets: listSecrets,
	run_with_secrets: runWithSecrets,
	request_access: requestAccess,
};

/** Answers one JSON-RPC message; null for notifications, which get no answer. */
export async function handle(
	message: Message,
	context: Context,
	notify: (message: Message) => void = () => {},
): Promise<Message | null> {
	const { id, method, params = {} } = message;
	if (id === undefined || id === null) return null;
	const reply = (result: unknown) => ({ jsonrpc: "2.0" as const, id, result });
	const fail = (code: number, text: string) => ({
		jsonrpc: "2.0" as const,
		id,
		error: { code, message: text },
	});
	switch (method) {
		case "initialize": {
			const asked = String(params.protocolVersion ?? "");
			return reply({
				protocolVersion: PROTOCOL_VERSIONS.includes(asked)
					? asked
					: PROTOCOL_VERSIONS[0],
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "vauly", title: "vauly", version },
				instructions:
					"Secrets from vauly, a team password manager. You never see their values: use list_secrets to see what this project can use, and run_with_secrets to run a command with them. A person approves each item the first time.",
			});
		}
		case "ping":
			return reply({});
		case "tools/list":
			return reply({ tools });
		case "tools/call": {
			const name = String(params.name ?? "");
			const run = handlers[name as keyof typeof handlers];
			if (!run) return fail(-32602, `There's no tool called ${name}.`);
			const token = (params._meta as { progressToken?: string | number })
				?.progressToken;
			const args = (params.arguments ?? {}) as Record<string, unknown>;
			try {
				return reply(
					await run(
						{
							...context,
							progress:
								token === undefined
									? undefined
									: (text, elapsed) =>
											notify({
												jsonrpc: "2.0",
												method: "notifications/progress",
												params: {
													progressToken: token,
													progress: elapsed,
													message: text,
												},
											}),
						},
						args,
					),
				);
			} catch (error) {
				return reply(
					text(
						error instanceof CliError ? error.message : String(error),
						undefined,
						true,
					),
				);
			}
		}
		default:
			return fail(-32601, `vauly mcp doesn't know ${method}.`);
	}
}

/** Reads JSON-RPC messages, one per line, from stdin and writes answers to stdout. */
export async function serve() {
	const context: Context = {
		cwd: process.cwd(),
		env: process.env,
		approvalWaitMs: Number(process.env.VAULY_MCP_APPROVAL_WAIT ?? 90) * 1000,
	};
	// stdout carries the protocol and nothing else.
	const send = (message: Message) =>
		process.stdout.write(`${JSON.stringify(message)}\n`);
	const lines = createInterface({ input: process.stdin });
	const running: Promise<void>[] = [];
	for await (const line of lines) {
		if (!line.trim()) continue;
		let message: Message;
		try {
			message = JSON.parse(line);
		} catch {
			send({
				jsonrpc: "2.0",
				id: null,
				error: { code: -32700, message: "That isn't JSON." },
			});
			continue;
		}
		running.push(
			handle(message, context, send).then((answer) => {
				if (answer) send(answer);
			}),
		);
	}
	await Promise.all(running);
}
