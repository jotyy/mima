import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { API_URL } from "../playwright.config";

const CLI = fileURLToPath(
	new URL("../../apps/cli/src/index.ts", import.meta.url),
);

/** Runs the real `vauly` CLI the way an agent would. */
export function vauly(args: string[], env: Record<string, string>) {
	const child: ChildProcess = spawn("bun", [CLI, ...args], {
		env: {
			...process.env,
			VAULY_SERVER: API_URL,
			VAULY_APPROVAL_TIMEOUT: "60",
			...env,
		},
	});
	let stdout = "";
	let stderr = "";
	child.stdout?.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr?.on("data", (chunk) => {
		stderr += chunk;
	});
	const exit = new Promise<number>((resolve) =>
		child.on("close", (code) => resolve(code ?? 1)),
	);
	return {
		exit,
		stdout: () => stdout,
		stderr: () => stderr,
		async waitForStderr(text: string, timeout = 30_000) {
			const started = Date.now();
			while (!stderr.includes(text)) {
				if (Date.now() - started > timeout) {
					throw new Error(`vauly never printed "${text}". stderr: ${stderr}`);
				}
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		},
	};
}
