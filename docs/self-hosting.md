# Self-hosting

mima runs on your own Cloudflare account. A deploy creates three things:
- **server**, a Worker that runs the API
- **web**, a Worker that serves the web app
- **database**, a D1 database, with the migrations in `packages/db/src/migrations` applied

The deploy is described in [`packages/infra/alchemy.run.ts`](../packages/infra/alchemy.run.ts) and run by [Alchemy](https://alchemy.run).

## Before you start

- A Cloudflare account
- [Bun](https://bun.sh) 1.3 or later
- A clone of this repository, with `bun install` run once

## 1. Connect Cloudflare

```sh
cd packages/infra
bunx alchemy profile edit
```

Pick Cloudflare and sign in. The profile is saved in `~/.alchemy` and used by every deploy from this machine.

## 2. Choose your settings

The deploy needs two values. Keep both somewhere safe; you'll use the same ones on every deploy.

| Setting              | What it is                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | Signs session cookies. Use at least 32 random characters, for example `openssl rand -base64 32`. Changing it signs everyone out. |
| `CORS_ORIGIN`        | The exact address of your web app, such as `https://mima.example.com`. The API only accepts requests from it.                    |

One more is optional. `VITE_BRANDFETCH_CLIENT_ID` picks where website logos come from: by default the web app and the extension load them from Brandfetch with the mima project's client ID. Set it to your own [Brandfetch client ID](https://developers.brandfetch.com), or to `off` to show plain icons and never contact Brandfetch.

Pass them in the environment when you deploy, as below. Values in the environment take precedence over `apps/server/.env`, which only holds your local development settings.

You won't know the web app's `workers.dev` address until the first deploy, so the first time, deploy with a placeholder and deploy again once you have it.

## 3. Deploy

```sh
cd packages/infra
BETTER_AUTH_SECRET='…' CORS_ORIGIN='https://mima.example.com' \
  bunx alchemy deploy --stage production
```

When it finishes, Alchemy prints the addresses of `web` and `server`. If `CORS_ORIGIN` doesn't match `web` yet, set it and run the same command again.

Alchemy keeps track of what it created per stage, so `--stage production` always updates the same Workers and database. Without `--stage`, it deploys a personal stage named after you, which is handy for trying changes.

## 4. Claim your workspace

Open the web app straight away. **The first person to visit creates the workspace and becomes its owner**, so don't leave a fresh deploy unclaimed. Then invite your team from **Members**; each invite link works once, for one email address.

## Your own domain

To serve mima from your own domain, add it to the `web` and `server` Workers in `packages/infra/alchemy.run.ts` (see Alchemy's Cloudflare docs for the current option), set `CORS_ORIGIN` to the new address, and deploy again.

## Upgrading

```sh
git pull
bun install
cd packages/infra
BETTER_AUTH_SECRET='…' CORS_ORIGIN='…' bunx alchemy deploy --stage production
```

New database migrations are applied during the deploy. Check [CHANGELOG.md](../CHANGELOG.md) before you upgrade.

## Backups

- **The database.** D1 keeps a point-in-time history you can restore from (Cloudflare calls it Time Travel; how far back depends on your plan). Everything sensitive in it is encrypted, so a database copy is only useful together with your team's master passwords.
- **Decrypted backups.** Any member can download every item they can open from **Settings → Download a backup**. The file is plain text: store it encrypted.

## Removing an instance

```sh
cd packages/infra
bunx alchemy destroy --stage production
```

This deletes the Workers **and the database with every item in it**. Download backups first.

## If the owner is locked out of two-step login

An admin can reset two-step login for anyone except the owner. If the owner loses both their phone and their recovery codes, open the instance's D1 database in the Cloudflare dashboard and run this in its console, with the owner's email:

```sql
UPDATE member SET totp_secret = NULL, totp_pending = NULL, totp_step = NULL, recovery_codes = NULL
WHERE user_id = (SELECT id FROM user WHERE email = 'owner@example.com');
```

Their master password alone signs them in again. It changes nothing about encryption: the master password is still the only key to their items.

## Good to know

- The `e2e` stage used by the test suite adds a route that wipes the database, guarded by `MIMA_E2E_RESET_TOKEN`. It only exists when that variable is set; never set it for a real deploy.
- `bun run dev` keeps its state on disk and never touches your Cloudflare account.
