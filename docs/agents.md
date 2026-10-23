# Agents and scripts

Some commands need a secret: a deploy script needs a database URL, a coding agent needs an API key to run the tests. The usual answer is to paste the value into an `.env` file, where anything on the machine, including the agent itself, can read it.

`mima run` does it differently. You write a reference instead of the value, and mima puts the value into the command's environment when it starts. The agent or script that called `mima run` never sees it, the command's output has it masked, and the first time a new item is used, a person in your team approves it.

You don't need any of this to use mima as a password manager. It's there for when you do.

<!-- diagram: AgentFlow -->

```
1. the agent runs    mima run -- npm test        (.env holds mima:// references)
2. mima asks         your server for the item
3. a person allows   it in mima: once, or for an hour
4. mima run          decrypts it on that machine and starts the command with it;
                     the value is <hidden> in the output
```

## 1. Create an agent

In mima, open **Agents** (under **Workspace**) and choose **New agent**. Give it a name you'll recognise in approvals, such as "Claude Code on Alex's laptop" or "CI deploy". mima shows two lines once:

```sh
MIMA_SERVER=https://mima-api.example.com
MIMA_TOKEN=mima_agent_agt_…
```

Put them in the environment where the agent or script runs. The token holds the agent's private key: treat it like a password. If it leaks, delete the agent in mima and create a new one.

## 2. Install the CLI

The CLI is a single file built with Bun:

```sh
bun run --cwd apps/cli build      # writes apps/cli/dist/mima
cp apps/cli/dist/mima /usr/local/bin/mima
mima whoami                       # checks MIMA_SERVER and MIMA_TOKEN
```

## 3. Reference an item

Open the item in mima, choose **…** then **Use with an agent…**, and copy its reference:

```
mima://itm_7k2m9qx4hc3r
```

A reference stands for the item's password or value. Add a field to pick something else: `/username`, `/url` or `/notes` (`/password`, `/value` and `/secret` all mean the value).

Use references anywhere you'd put the value, in the environment or in an `.env` file:

```sh
# .env
DATABASE_URL=mima://itm_7k2m9qx4hc3r
STRIPE_KEY=mima://itm_3f8w2kq9xm1t
```

## 4. Run the command

```sh
mima run -- npm run deploy
mima run --env-file .env -- npm test
```

`mima run` finds every reference, gets each value, starts the command with the values in its environment, and replaces any of those values that appear in the command's output with `<hidden>`. Variables without a reference pass through unchanged.

## Approvals

The first time an agent asks for an item it hasn't been allowed to use, `mima run` waits, and mima shows the request to people who can open that item: in **Needs you** on the Overview, and as a waiting-for-approval link at the top right. They can:
- **Allow once**: this run gets the value; the next run asks again.
- **Allow for 1 hour**: runs in the next hour don't ask.
- **Deny**: the run stops with an error.

To let an agent use an item without asking, open the item, choose **Use with an agent…**, pick the agent and how long. Every agent that can use an item is listed on it, with a switch to take that away.

`mima run` waits up to five minutes for an answer. Set `MIMA_APPROVAL_TIMEOUT` (in seconds) to change that.

## What's recorded

Every request, approval, denial and value handed to an agent appears in **Activity**, with the command that asked for it. Pausing an agent stops its token right away; deleting an item takes it out of every agent's reach until it's restored.

## Environment

| Variable                |                                                         |
| ----------------------- | ------------------------------------------------------- |
| `MIMA_SERVER`           | The URL of your mima API                                |
| `MIMA_TOKEN`            | The agent's token, shown once when the agent is created |
| `MIMA_APPROVAL_TIMEOUT` | Seconds to wait for a person to approve; default 300    |
