# Security policy

vauly stores the secrets of the teams that run it, so we take reports seriously and are grateful for them.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/jotyy/vauly/security/advisories/new)). Only the maintainers can see the report.

Helpful things to include:
- what an attacker can do, and what they need first (an account, a member's session, control of the server, …)
- the steps to reproduce it, ideally against a local instance (`bun run dev`)
- the commit or version you tested

We'll confirm we've received the report, keep you updated while we work on a fix, and credit you in the release notes if you'd like. Please give us a reasonable amount of time to release a fix before you share details publicly.

## Supported versions

vauly has no stable release yet. Fixes go to the `main` branch; run the latest `main` to get them.

## Scope

In scope:
- anything that lets someone read an item, a vault key or a private key they shouldn't
- ways around the access rules in the API, such as opening a vault you weren't given, or acting as another member or agent
- weaknesses in the cryptography in `packages/crypto`
- the CLI (`apps/cli`) leaking a value outside the command it was given to

Known limits of the design, such as a compromised server serving modified JavaScript, are described in [docs/security.md](docs/security.md). Reports that show those limits are easier to exploit than described there are welcome.

Out of scope: findings that need a compromised device, social engineering of team members, denial of service against your own Cloudflare account, and reports from automated scanners without a demonstrated impact.
