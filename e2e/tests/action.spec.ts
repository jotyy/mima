import { spawn } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

import { API_URL } from "../playwright.config";
import {
	createWorkspace,
	openAllItems,
	resetWorkspace,
	sidebarLink,
} from "./helpers";

// vauly's GitHub Action, run the way the runner runs it: its step script with the
// runner's variables, against the e2e stack, with a CI agent and made-up items. What
// the action prints is the job's log, and a value may appear in it only inside the
// ::add-mask:: commands that the runner reads and keeps out of the log.
// .github/workflows/action.yml runs the action itself on GitHub, and checks the real log.

test.describe.configure({ mode: "serial" });

const DEPLOY_TOKEN = "dpl_made-up-not-real_9f3k2m7q";
const OTHER = "made-up-staging-key-4r8t1w";
const action = fileURLToPath(new URL("../../action", import.meta.url));
const cli = fileURLToPath(
	new URL("../../apps/cli/src/index.ts", import.meta.url),
);
let token = "";
let deployRef = "";
let otherRef = "";

async function addKey(page: Page, name: string, value: string) {
	await openAllItems(page);
	await page.getByRole("button", { name: "New item" }).click();
	const form = page.getByRole("dialog");
	await form.getByRole("tab", { name: "API key" }).click();
	await form.getByLabel("Name", { exact: true }).fill(name);
	await form.getByLabel("Value").fill(value);
	await form.getByRole("button", { name: "Add item" }).click();
	await expect(form).toBeHidden();
	await page.getByRole("button", { name: "More actions" }).click();
	await page.getByRole("menuitem", { name: "Use with an agent…" }).click();
	const reference = (
		(await page
			.getByRole("dialog")
			.getByText(/^vauly:\/\/itm_/)
			.textContent()) ?? ""
	).trim();
	return reference;
}

test.beforeAll(async ({ browser, request }) => {
	await resetWorkspace(request);
	const page = await browser.newPage();
	await createWorkspace(page);

	// The agent first, so the deploy token can be granted to it from the item.
	await sidebarLink(page, "Agents").click();
	await page.getByRole("button", { name: "New agent" }).first().click();
	const dialog = page.getByRole("dialog");
	await dialog.getByLabel("Name").fill("Deploys");
	await dialog.getByRole("tab", { name: "CI job" }).click();
	await dialog.getByRole("button", { name: "Create agent" }).click();
	const env = dialog.getByTestId("agent-env");
	await expect(env).toContainText("VAULY_TOKEN=vauly_agent_");
	token = /VAULY_TOKEN=(\S+)/.exec((await env.textContent()) ?? "")?.[1] ?? "";
	await page.keyboard.press("Escape");

	deployRef = await addKey(page, "Deploy token", DEPLOY_TOKEN);
	const grant = page.getByRole("dialog");
	await grant.getByRole("tab", { name: "Until I revoke it" }).click();
	await grant.getByRole("button", { name: "Grant access" }).click();
	await expect(page.getByText("Deploys can use Deploy token")).toBeVisible();

	// Nobody allows this one.
	otherRef = await addKey(page, "Staging key", OTHER);
	await page.keyboard.press("Escape");
	await page.close();
});

/**
 * The action's second step, as the runner starts it: the inputs as VAULY_ACTION_*
 * variables, and the CLI where the first step installs it, here a wrapper that runs it
 * from source.
 */
function runAction(
	inputs: Record<string, string>,
	{
		timeout = "60",
		stepEnv = {},
	}: { timeout?: string; stepEnv?: Record<string, string> } = {},
) {
	const runnerTemp = mkdtempSync(join(tmpdir(), "vauly-action-"));
	const bin = join(runnerTemp, "vauly-bin");
	mkdirSync(bin);
	writeFileSync(
		join(bin, "vauly"),
		`#!/bin/sh\nexec bun ${JSON.stringify(cli)} "$@"\n`,
	);
	chmodSync(join(bin, "vauly"), 0o755);
	const githubEnv = join(runnerTemp, "github_env");
	writeFileSync(githubEnv, "");
	const child = spawn("bash", [join(action, "run.sh")], {
		env: {
			PATH: process.env.PATH,
			HOME: process.env.HOME,
			RUNNER_TEMP: runnerTemp,
			GITHUB_ENV: githubEnv,
			GITHUB_ACTIONS: "true",
			VAULY_SERVER: API_URL,
			VAULY_TOKEN: token,
			VAULY_APPROVAL_TIMEOUT: timeout,
			...stepEnv,
			...Object.fromEntries(
				Object.entries(inputs).map(([name, value]) => [
					`VAULY_ACTION_${name.toUpperCase()}`,
					value,
				]),
			),
		},
	});
	// The runner shows both streams in the log; they're kept apart here, since a masked
	// stream can hold back the end of a line while the other one goes on.
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	return new Promise<{ code: number; log: string; githubEnv: string }>(
		(resolve) =>
			child.on("close", (code) =>
				resolve({
					code: code ?? 1,
					log: `${stdout}\n${stderr}`,
					githubEnv: readFileSync(githubEnv, "utf8"),
				}),
			),
	);
}

/** The log as the runner shows it: without the ::add-mask:: commands it reads. */
const shown = (log: string) =>
	log
		.split("\n")
		.filter((line) => !line.startsWith("::add-mask::"))
		.join("\n");

test("run: the script gets the value, and the log never shows it", async () => {
	const result = await runAction({
		env: `DEPLOY_TOKEN=${deployRef}\n`,
		run: [
			'test "$DEPLOY_TOKEN" = "' +
				DEPLOY_TOKEN +
				'" && echo "the token arrived"',
			'echo "token: $DEPLOY_TOKEN"',
			'echo "$DEPLOY_TOKEN" >&2',
			'test -z "$VAULY_TOKEN" && echo "no agent token in the script"',
		].join("\n"),
	});
	expect(result.code).toBe(0);
	expect(result.log).toContain("the token arrived");
	expect(result.log).toContain("token: <hidden>");
	expect(result.log).toContain("no agent token in the script");
	expect(result.log).not.toContain(DEPLOY_TOKEN);
	expect(result.githubEnv).toBe("");
});

test("run: a reference in the step's own env works too, and the script's exit code counts", async () => {
	const result = await runAction(
		{
			run:
				'test "$DEPLOY_TOKEN" = "' +
				DEPLOY_TOKEN +
				'" && echo "from the step"; exit 3',
		},
		{ stepEnv: { DEPLOY_TOKEN: deployRef } },
	);
	expect(result.code).toBe(3);
	expect(result.log).toContain("from the step");
	expect(result.log).not.toContain(DEPLOY_TOKEN);
});

test("export: later steps get the value through GITHUB_ENV, masked first", async () => {
	const result = await runAction({
		env: `# for the deploy step\nDEPLOY_TOKEN=${deployRef}\n`,
		export: "true",
	});
	expect(result.code).toBe(0);
	expect(result.log).toContain(`::add-mask::${DEPLOY_TOKEN}`);
	expect(shown(result.log)).not.toContain(DEPLOY_TOKEN);
	expect(result.log).toContain("exported DEPLOY_TOKEN");
	expect(result.githubEnv).toMatch(
		new RegExp(
			`^DEPLOY_TOKEN<<(vauly_[0-9a-f]{32})\\n${DEPLOY_TOKEN}\\n\\1\\n$`,
		),
	);
});

test("an item nobody approves fails the step when the timeout passes", async () => {
	const result = await runAction(
		{ env: `STAGING_KEY=${otherRef}`, run: 'echo "never here"' },
		{ timeout: "3" },
	);
	expect(result.code).not.toBe(0);
	expect(result.log).toContain("needs approval for 1 item");
	expect(result.log).toContain("Nobody approved the request in time.");
	expect(result.log).not.toContain("never here");
	expect(result.log).not.toContain(OTHER);

	const exported = await runAction(
		{ env: `STAGING_KEY=${otherRef}`, export: "true" },
		{ timeout: "3" },
	);
	expect(exported.code).not.toBe(0);
	expect(exported.log).toContain("::error title=vauly::Nothing was exported");
	expect(exported.githubEnv).toBe("");
});

test("inputs that don't make sense stop the step before vauly runs", async () => {
	for (const [inputs, message] of [
		[{ env: `DEPLOY_TOKEN=${deployRef}` }, "Give run"],
		[{ export: "true", run: "true" }, "there are none"],
		[
			{ env: "DEPLOY_TOKEN=plain-value", run: "true" },
			"isn't a vauly:// reference",
		],
		[{ env: "not a line", run: "true" }, "Each line of env is NAME=vauly://"],
		[
			{ env: `DEPLOY_TOKEN=${deployRef}`, run: "true", shell: "zsh" },
			"shell is bash or sh",
		],
	] as const) {
		const result = await runAction(inputs);
		expect(result.code).toBe(2);
		expect(result.log).toContain("::error title=vauly::");
		expect(result.log).toContain(message);
	}
});

test("a value of several lines is masked whole and line by line", async () => {
	const runnerTemp = mkdtempSync(join(tmpdir(), "vauly-export-"));
	const masks = join(runnerTemp, "masks");
	const values = join(runnerTemp, "values");
	const key =
		"-----BEGIN MADE-UP KEY-----\nAbCdEf123456\n%not-a-real-key\n-----END-----";
	const child = spawn("bash", [join(action, "export.sh"), "SIGNING_KEY"], {
		env: {
			PATH: process.env.PATH,
			SIGNING_KEY: key,
			VAULY_ACTION_MASKS: masks,
			VAULY_ACTION_VALUES: values,
		},
	});
	expect(await new Promise((resolve) => child.on("close", resolve))).toBe(0);
	expect(readFileSync(masks, "utf8").split("\n")).toEqual([
		"::add-mask::-----BEGIN MADE-UP KEY-----%0AAbCdEf123456%0A%25not-a-real-key%0A-----END-----",
		"::add-mask::-----BEGIN MADE-UP KEY-----",
		"::add-mask::AbCdEf123456",
		"::add-mask::%25not-a-real-key",
		"::add-mask::-----END-----",
		"",
	]);
	const [first, ...rest] = readFileSync(values, "utf8").split("\n");
	const delimiter = first?.replace("SIGNING_KEY<<", "");
	expect(rest.join("\n")).toBe(`${key}\n${delimiter}\n`);
});
