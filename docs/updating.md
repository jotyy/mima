# Updating vauly

New versions of vauly land on GitHub. This page covers how to bring your copy up to date, what updates by itself and what doesn't, and what an update needs from you when it needs anything.

## Before you update

- **Read the notes below**, and [CHANGELOG.md](../CHANGELOG.md) for what's new.
- **Keep a way back.** D1 keeps a point-in-time history of your database (Cloudflare calls it Time Travel; how far back depends on your plan), so you can restore it to the minute before the update. For a copy of your own, `bunx wrangler d1 export vauly --remote --output vauly.sql` saves the whole database, still encrypted. Each person can also download what they can open from **Settings → Download a backup**: a decrypted file, so keep it somewhere safe and delete it when you're done.

## Update the server

**A copy made with the Deploy to Cloudflare button:** in your copy of vauly on GitHub, open **Actions → Update vauly → Run workflow**. It replaces the files with the latest vauly and pushes, and Cloudflare builds and deploys it.

It keeps two things as they are:
- `wrangler.jsonc`, which names your Worker and its database. When an update needs a change there, the notes below say so.
- `.github/workflows`, which GitHub's default token can't change. To let updates replace the workflows too, add a repository secret named `VAULY_UPDATE_TOKEN`: a fine-grained token for that repository with read and write access to Contents and Workflows.

**Deployed from your machine:**

```sh
git pull
bun install
bun run build
bun run deploy
```

Either way, the Worker updates the database itself on its first request after the deploy. It applies each migration it's missing, once and in order.

## Update the browser extension and the CLI

They don't update with the server, so update them at the same time:
- **The extension:** run `bun install` and `bun run --cwd apps/extension build` in an up-to-date checkout, then choose **Reload** on vauly in `chrome://extensions`.
- **The CLI:** run the installer again (`curl -fsSL https://vauly.app/install.sh | sh`), or rebuild it the way you built it.

## Going back

Deploying an older version is possible, but it doesn't undo database migrations, and it may not understand what the newer one wrote. If an update goes wrong, restore the database to the minute before it and deploy the version you had, rather than only deploying the older version. The notes say when going back has a catch.

## What each update needs from you

### Copies deployed before October 24, 2026

This update brings the import from other password managers, passkeys, vault roles, Argon2id and more. Four things to know:
1. **Update the browser extension along with the server.** Each person's master password moves from PBKDF2 to Argon2id the next time they sign in or unlock in the web app. An extension built before this update can't unlock an account that has moved.
2. **Add one line to `wrangler.jsonc`.** Under `"assets"`, add `"binding": "ASSETS"`, then commit it, which deploys again:

   ```jsonc
   "assets": {
   	"directory": "apps/web/dist",
   	"binding": "ASSETS",
   	// …the rest as it is
   }
   ```

   The update keeps your `wrangler.jsonc`, so it can't add this itself. Without it vauly still works, but the settings your build sets, such as `VITE_BRANDFETCH_CLIENT_ID=off` to hide logos or `VITE_BREACH_CHECK=off`, don't reach the app.
3. **Migrations run on their own.**
   - Everyone keeps the access they had to shared vaults, as **manage**, the new role with every right.
   - Agents that belonged to someone who had already left the workspace are deleted, along with what they were granted.
   - The key derivation settings get columns of their own.
4. **Don't go back past this update** once people have signed in. An older version can't unlock an account that has moved to Argon2id. Restore the database as well if you have to go back.

The web app also sends a strict Content-Security-Policy now, and other sites can't show it in a frame. If you added scripts or embeds of your own to the app, they're blocked.
