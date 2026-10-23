# Agents and scripts

Some commands need a secret: a deploy script needs a database URL, a coding agent needs an API key to run the tests. The usual answer is to paste the value into an `.env` file, where anything on the machine, including the agent itself, can read it.

`vauly run` does it differently. You write a reference instead of the value, and vauly puts the value into the command's environment when it starts. The agent or script that called `vauly run` never sees it, the command's output has it masked, and the first time a new item is used, a person in your team approves it.

You don't need any of this to use vauly as a password manager. It's there for when you do.

<!-- diagram: AgentFlow -->

```
1. the agent runs    vauly run -- npm test        (.env holds vauly:// references)
2. vauly asks         your server for the item
3. a person allows   it in vauly: once, or for an hour
4. vauly run          decrypts it on that machine and starts the command with it;
                     the value is <hidden> in the output
```

## 1. Create an agent

In vauly, open **Agents** (under **Workspace**) and choose **New agent**. Give it a name you'll recognise in approvals, such as "Claude Code on Alex's laptop" or "CI deploy". vauly shows two lines once:

```sh
VAULY_SERVER=https://vauly-api.example.com
VAULY_TOKEN=vauly_agent_agt_…
```

Put them in the environment where the agent or script runs. The token holds the agent's private key: treat it like a password. If it leaks, delete the agent in vauly and create a new one.

## 2. Install the CLI

The CLI is a single file built with Bun:

```sh
bun run --cwd apps/cli build      # writes apps/cli/dist/vauly
cp apps/cli/dist/vauly /usr/local/bin/vauly
vauly whoami                       # checks VAULY_SERVER and VAULY_TOKEN
```

## 3. Reference an item

Open the item in vauly, choose **…** then **Use with an agent…**, and copy its reference:

```
vauly://itm_7k2m9qx4hc3r
```

A reference stands for the item's password or value. Add a field to pick something else: `/username`, `/url` or `/notes` (`/password`, `/value` and `/secret` all mean the value).

Use references anywhere you'd put the value, in the environment or in an `.env` file:

```sh
# .env
DATABASE_URL=vauly://itm_7k2m9qx4hc3r
STRIPE_KEY=vauly://itm_3f8w2kq9xm1t
```

## 4. Run the command

```sh
vauly run -- npm run deploy
vauly run --env-file .env -- npm test
```

`vauly run` finds every reference, gets each value, starts the command with the values in its environment, and replaces any of those values that appear in the command's output with `<hidden>`. Variables without a reference pass through unchanged.

## Coding agents over MCP

Coding agents such as Claude Code and Cursor can use vauly as an MCP server. `vauly mcp` is the same agent as `vauly run`: the same token, the same approvals, and the same rule that the agent never sees a value. It reads the vauly:// references from the `.env` in the project, or from variables the agent passes.

| Tool               | What it does                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_secrets`     | Lists the variables that hold a reference, and whether the agent may use each item yet or a person has to approve it first. No values, and no item names.                                                                      |
| `run_with_secrets` | Runs a shell command with the values in its environment, like `vauly run`, and returns its exit code and output with every value as `<hidden>`. A new item waits for approval, then returns without running if nobody answers. |
| `request_access`   | Asks a person to allow items, with a reason they read when they approve. Nothing runs.                                                                                                                                         |

There is no tool that returns a value. Whatever a tool returns lands in the model's context, and from there in transcripts and logs; everything an agent does with a secret, such as tests, migrations and deploys, works through `run_with_secrets` instead.

Keep the token out of files you commit. Set it in your shell, and let the client pass it on.

**Claude Code**, for your user only:

```sh
claude mcp add vauly \
  -e VAULY_SERVER=https://vauly-api.example.com \
  -e VAULY_TOKEN=vauly_agent_agt_… \
  -- vauly mcp
```

Or for everyone on the project, in `.mcp.json`, with each person's token from their environment:

```json
{
	"mcpServers": {
		"vauly": {
			"command": "vauly",
			"args": ["mcp"],
			"env": {
				"VAULY_SERVER": "${VAULY_SERVER}",
				"VAULY_TOKEN": "${VAULY_TOKEN}"
			}
		}
	}
}
```

**Cursor**, in `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
	"mcpServers": {
		"vauly": {
			"command": "vauly",
			"args": ["mcp"],
			"env": {
				"VAULY_SERVER": "https://vauly-api.example.com",
				"VAULY_TOKEN": "${env:VAULY_TOKEN}"
			}
		}
	}
}
```

**Other clients** that start servers over stdio need the command `vauly`, the argument `mcp`, and `VAULY_SERVER` and `VAULY_TOKEN` in its environment. The server works in the directory the client starts it in; every tool also takes a `cwd`, for clients that start servers somewhere else.

When an item needs approval, `run_with_secrets` asks in vauly, tells the client it's waiting, and waits 90 seconds (`VAULY_MCP_APPROVAL_WAIT`). If nobody has answered by then, it returns without running and says so; the request stays open, and the next call picks up the answer. Some clients stop waiting for a tool sooner than that, which is what `request_access` is for: ask first, then run once the person has said yes.

Masking catches a value only as it is. A command that prints it changed, such as base64-encoded or reversed, gets past it, with `run_with_secrets` as with `vauly run`. The agent can run commands either way, as any coding agent with a shell can.

## Approvals

The first time an agent asks for an item it hasn't been allowed to use, `vauly run` waits, and vauly shows the request to people who can open that item: in **Needs you** on the Overview, and as a waiting-for-approval link at the top right. They can:
- **Allow once**: this run gets the value; the next run asks again.
- **Allow for 1 hour**: runs in the next hour don't ask.
- **Deny**: the run stops with an error.

To let an agent use an item without asking, open the item, choose **Use with an agent…**, pick the agent and how long. Every agent that can use an item is listed on it, with a switch to take that away.

`vauly run` waits up to five minutes for an answer. Set `VAULY_APPROVAL_TIMEOUT` (in seconds) to change that.

## What's recorded

Every request, approval, denial and value handed to an agent appears in **Activity**, with the command that asked for it. Pausing an agent stops its token right away; deleting an item takes it out of every agent's reach until it's restored. An agent works for the person who created it: when they're taken out of a vault, their agents lose the items in it, whoever approved them, and when they leave the workspace, their agents are deleted.

## Environment

| Variable                  |                                                                             |
| ------------------------- | --------------------------------------------------------------------------- |
| `VAULY_SERVER`            | The URL of your vauly API                                                   |
| `VAULY_TOKEN`             | The agent's token, shown once when the agent is created                     |
| `VAULY_APPROVAL_TIMEOUT`  | Seconds to wait for a person to approve; default 300                        |
| `VAULY_MCP_APPROVAL_WAIT` | Seconds `run_with_secrets` waits for a person before it returns; default 90 |
