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

| Variable                 |                                                         |
| ------------------------ | ------------------------------------------------------- |
| `VAULY_SERVER`           | The URL of your vauly API                               |
| `VAULY_TOKEN`            | The agent's token, shown once when the agent is created |
| `VAULY_APPROVAL_TIMEOUT` | Seconds to wait for a person to approve; default 300    |
