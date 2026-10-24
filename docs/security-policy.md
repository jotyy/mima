# Security policy

vauly keeps the secrets of the teams that run it, so we take reports seriously and are grateful for them. This page says how to report a problem, what's in scope, what you can expect from us, and what we promise people who look for problems in good faith.

## Reporting a vulnerability

**Please don't open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub instead: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/jotyy/vauly/security/advisories/new)). Only the maintainers can see the report. Every vauly site and instance points there too, in its `/.well-known/security.txt`.

Helpful things to include:
- what an attacker can do, and what they need first (an account, a member's session, control of the server, …)
- the steps to reproduce it, ideally against a local instance (`bun run dev`)
- the commit or version you tested

## What to expect

- We confirm we've received your report within a week, usually sooner.
- We keep you updated while we work on a fix, and tell you when it's released.
- If you'd like, we credit you in the release notes and on this page.

Please give us up to 90 days to release a fix before you share details publicly, unless we agree on another date together.

## Safe harbor

If you look for problems in good faith and follow this policy, we consider your research authorized. We won't take legal action against you or ask anyone else to, and if someone else does, we'll make it known that you had our permission.

Good faith means that you:
- test against an instance of your own, such as `bun run dev` or your own deploy, or against the demo at [demo.vauly.app](https://demo.vauly.app). Every other vauly belongs to the team that runs it, and we can't give you permission to test theirs.
- don't look at, keep or share anyone else's data beyond what's needed to show the problem.
- don't make a service worse for other people, for example by flooding the demo.
- report the problem to us privately, and give us time to fix it.

## Scope

In scope:
- anything that lets someone read an item, a vault key or a private key they shouldn't
- ways around the access rules in the API, such as opening a vault you weren't given, or acting as another member or agent
- weaknesses in the cryptography in `packages/crypto`
- the CLI (`apps/cli`) leaking a value outside the command it was given to

Known limits of the design, such as a compromised server serving modified JavaScript, are described in [Security](security.md). Reports that show those limits are easier to exploit than described there are welcome.

Out of scope: findings that need a compromised device, social engineering of team members, denial of service against your own Cloudflare account, and reports from automated scanners without a demonstrated impact.

## Supported versions

Security fixes go into the [latest release](https://github.com/jotyy/vauly/releases/latest), as a patch release such as 0.1.1 when one is needed, and into `next`, the development branch. Older releases don't get them, so keep your copy on the latest release: [Updating vauly](updating.md) explains how. **Settings › About** shows which version a copy runs.

## Thanks

Nobody has reported a vulnerability yet. People who report one we fix are listed here, if they'd like to be.
