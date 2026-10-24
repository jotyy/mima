# Self-hosting

vauly runs on your own Cloudflare account. A deploy creates two things:
- **vauly**, a Worker that serves the web app and its API
- **vauly**, a D1 database for your items, encrypted before they arrive

<!-- diagram: Architecture -->

```
 your browser ──┐        ┌─ your Cloudflare account ──────────────────────┐
 the extension ─┼─ HTTPS ─▶  vauly    Worker   the app and its API         │
 vauly run ──────┘        │     └──▶ vauly    D1       items as ciphertext  │
                         └────────────────────────────────────────────────┘
 everything is encrypted on the left; the right only ever holds ciphertext
```

A small team fits in Cloudflare's free plan.

## Deploy with one click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jotyy/vauly)
1. Click the button, sign in to Cloudflare, and connect GitHub or GitLab. Cloudflare copies vauly into a new repository of yours and builds it from there.
2. When it asks for `SETUP_CODE`, choose a code only you know, for example from `openssl rand -hex 16`. It keeps a fresh vauly from being claimed by whoever finds it first.
3. Deploy. When it's done, open your vauly's address followed by `/setup?code=` and your code, and create the workspace. You become its owner. Invite your team from **Members**; each invite link works once, for one email address.

That's all the setup there is. The Worker applies the database migrations on its first request, and makes the secret that signs sessions on first start, keeping it in the database. Without a `SETUP_CODE`, whoever opens your vauly first creates the workspace, so don't leave such a deploy unclaimed.

### Updating

In your copy of vauly on GitHub, open **Actions → Update vauly → Run workflow**. It replaces the files with the latest vauly and pushes, and Cloudflare deploys the update. The Worker applies any new migrations on its first request.

[Updating vauly](updating.md) has the rest: what the update keeps, the browser extension and the CLI, going back, and what a particular update needs from you. Read it before you update.

## Deploy from your machine

You need [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/jotyy/vauly.git
cd vauly
bun install
bunx wrangler login
echo "SETUP_CODE=$(openssl rand -hex 16)" > .dev.vars
bun run build
bun run deploy -- --secrets-file .dev.vars
```

`.dev.vars` keeps your setup code; git ignores it. Wrangler prints your vauly's address, and you claim it the same way, at `/setup?code=` followed by the code.

To update, run `git pull`, `bun install`, `bun run build` and `bun run deploy`, after reading [Updating vauly](updating.md).

## Your own domain

In the Cloudflare dashboard, open the **vauly** Worker, then **Settings → Domains & Routes → Add → Custom domain**. The app and the API move together, so there's nothing else to change. The domain's DNS has to be on Cloudflare.

## Settings

| Setting                     | What it does                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SETUP_CODE`                | Secret. Creating the workspace takes this code until someone has. It no longer matters once the workspace has an owner.                                                                                                                                                                                                                                                                     |
| `BETTER_AUTH_SECRET`        | Secret, optional. Signs sessions. Without it, vauly makes one and keeps it in the database. Changing it signs everyone out.                                                                                                                                                                                                                                                                 |
| `VITE_BRANDFETCH_CLIENT_ID` | Build variable, optional: for a one-click deploy, under the Worker's **Settings → Build → Variables and secrets**. Where website logos come from: by default the web app and the extension load them from Brandfetch with the vauly project's client ID. Use your own [Brandfetch client ID](https://developers.brandfetch.com), or `off` to show plain icons and never contact Brandfetch. |
| `VITE_BREACH_CHECK`         | Build variable, optional, set the same way. `off` stops the web app checking passwords against Have I Been Pwned for everyone, and hides the switch in Settings. On by default; see [Security](security.md#breached-passwords).                                                                                                                                                             |

Add secrets in the dashboard under the Worker's **Settings → Variables and Secrets**, or with `bunx wrangler secret put`.

## Backups

- **The database.** D1 keeps a point-in-time history you can restore from (Cloudflare calls it Time Travel; how far back depends on your plan). Everything sensitive in it is encrypted, so a database copy is only useful together with your team's master passwords.
- **Decrypted backups.** Any member can download every item they can open from **Settings → Download a backup**. The file is plain text: store it encrypted.

## Removing an instance

Delete the **vauly** Worker and the **vauly** D1 database in the Cloudflare dashboard, or run `bunx wrangler delete` and `bunx wrangler d1 delete vauly`. Deleting the database deletes **every item in it**, so download backups first.

## When someone deletes their account

Anyone can delete their own account under **Settings → Delete my account**, with their master password; app stores require it, and it's fair. It works exactly like an admin removing them:
- Their account and sessions, their private vault and its items, and their agents are deleted.
- A shared vault they were the last manager of passes to the people who could edit it, or to everyone left in it when nobody could.
- A shared vault nobody else could open is deleted, since nobody is left who could read it. The dialog lists what happens to each vault before they confirm.
- The activity log keeps their name and that they left, and the Overview points at the items they could see.

The owner can't delete their account while others remain: they make someone else the owner on the **Members** page first, and stay as an admin. When the owner is the last person in the workspace, deleting their account deletes the whole workspace, and the next visit to the instance starts a new one (behind the `SETUP_CODE`, if you set one). The Worker and its database stay; see above to remove those too.

## If the owner is locked out of two-step login

An admin can reset two-step login for anyone except the owner. If the owner loses both their phone and their recovery codes, open the instance's D1 database in the Cloudflare dashboard and run this in its console, with the owner's email:

```sql
UPDATE member SET totp_secret = NULL, totp_pending = NULL, totp_step = NULL, recovery_codes = NULL
WHERE user_id = (SELECT id FROM user WHERE email = 'owner@example.com');
```

Their master password alone signs them in again. It changes nothing about encryption: the master password is still the only key to their items.

## Deploying with Alchemy

The repository's development stack uses [Alchemy](https://alchemy.run) (`packages/infra/alchemy.run.ts`), which can also deploy, as two Workers: one for the web app and one for the API. `bun run deploy:stack -- --stage production` does that. It needs `BETTER_AUTH_SECRET`, and `CORS_ORIGIN` set to the web app's address; the one-Worker deploy above needs neither and is the simpler choice.

## Checking what your instance serves

With the [CLI](agents.md) installed, `vauly verify https://vault.example.test` checks that your vauly serves exactly the web app its commit builds. It rebuilds that commit, so it needs `git` and `bun`; with `--against vauly-build.json` it compares with a release's manifest instead. [Security](security.md#checking-what-an-instance-serves) explains what that proves.
- **Every file differs:** the build ran in another runtime, such as Node or another Bun version than the one in `package.json`. `vauly verify` names the two runtimes when it can. Instances built before vauly built in Bun everywhere can't match a rebuild.
- **`sw.js` alone differs, against a release's manifest:** version 0.1.0 listed the service worker's files in the order the build machine's file system gave them, so its release manifest, built on Linux, matches only builds from a similar machine. Check a 0.1.0 instance by rebuilding (without `--against`); later versions match on any machine.
- **`index.html` alone differs:** a Cloudflare feature that rewrites pages on your domain is the usual cause. Examples are Email Address Obfuscation, Rocket Loader, or Web Analytics added automatically. Turn it off for the domain.
- **The build settings above are public.** They end up in `/vauly.json` and in the headers, not in the app's code, which is what keeps the code the same for every instance.

## Good to know

- The test suite's stacks add a route that wipes the database, guarded by `E2E_RESET_TOKEN`. It only exists when that variable is set; never set it for a real deploy.
- `bun run dev` keeps its state on disk and never touches your Cloudflare account.
