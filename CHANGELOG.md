# Changelog

Notable changes to vauly. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

The first public version.

### Added

- End-to-end encryption: items, vault names and private keys are encrypted in the browser; the server stores ciphertext and wrapped keys only.
- Workspaces with an owner, admins and members. The first visitor creates the workspace; everyone else joins with a one-time invite link.
- Two-step login: a code from an authenticator app after the master password, with ten one-time recovery codes. It works the same in the web app and the browser extension, and admins can reset it for someone who lost their phone.
- A private vault for everyone, and shared vaults opened to people one by one. Each person can view, edit or manage a shared vault: viewers open, copy and fill items; editors also change them and share them by link or with agents; managers also choose who can open the vault. Existing access becomes manage.
- Logins with one-time codes, API keys, SSH keys and secure notes, with a password generator and strength check.
- Share links: send one item to someone outside the workspace through a link that expires after an hour to 30 days, optionally after one view. The copy is encrypted with a key that lives only in the link, and every opening is logged.
- Password health: the Overview lists weak passwords, logins that share a password, and items that someone who lost access could see and that haven't changed since. Each opens a filtered list to fix them.
- Search and a command palette (⌘K) that copies a password without opening the item. Copied secrets clear from the clipboard after 90 seconds.
- An activity log of reveals, copies, shares, imports and backups. Each item shows its own recent activity, and the log can narrow down to one item.
- Import from…: pick the app you're leaving, follow its export steps and drop the file in. vauly reads 1Password's .1pux, Bitwarden's JSON, KeePass and KeePassXC XML, the exports of LastPass, Dashlane, Keeper, NordPass, RoboForm, Proton Pass, Enpass and Apple Passwords, Chrome, Edge, Brave and Firefox, or any CSV with a password column. One-time codes, API keys, SSH keys, custom fields and earlier passwords come along, folders become tags, and the review names what stays behind. The file is read and encrypted in the browser.
- Delete your own account under Settings, behind your master password and a typed confirmation. It works like an admin removing you; the dialog lists what happens to each shared vault first. The owner makes someone else the owner on the Members page first, or, as the last person, deletes the whole workspace.
- Settings: change your name, change your master password, choose when vauly locks on this device, rename the workspace, and download a decrypted backup.
- A Get started checklist on the Overview of a new workspace: add items, invite the team, add the browser extension, print the Emergency Kit.
- The Emergency Kit: a printable page with your sign-in address, your email and a blank for your master password, from the checklist or Settings.
- Settings lists the browsers you're signed in on, and can sign out one of them or every other one. A browser signed out this way, or one whose person was removed, drops its keys and returns to sign-in on its next request.
- Recently deleted: deleted items can be restored for 30 days, and the deletion can be undone from its notification.
- Earlier passwords: a changed password or value stays on the item, encrypted, with when it was replaced and by whom.
- Agents and `vauly run`, which hands an item's value to a command without showing it to the caller, with approvals in the web app.
- Prebuilt CLI for macOS, Linux and Windows on GitHub releases, installed with `curl -fsSL https://vauly.app/install.sh | sh`, which checks it against the release's SHA256SUMS. `vauly --version` says which build it is.
- `vauly mcp`: an MCP server for coding agents, with tools that list what a project can use, run a command with the values masked in its output, and ask a person for access. No tool returns a value.
- A browser extension for Chromium browsers that lists the items for the current site, fills login forms and copies usernames, passwords and one-time codes. After you sign in on a site, it offers to save the new login or update a changed password.
- Brand logos for logins and well-known services, in the web app and the extension, from Brandfetch. Only a brand's own domain is looked up, never a subdomain or a private address, and logos can be turned off per device or per instance.
- Layouts for phones, light and dark themes, and installing vauly as an app (PWA).
- Unlock with a passkey: Face ID, Touch ID, Windows Hello or the device's PIN instead of the master password, turned on per device in Settings, for 14 days at a time. A copy of the private key is sealed with a key made from the passkey's PRF output and a pepper the server gives only inside the session the copy was made in, and it's kept on that device only.
- Test vectors for the cryptography (`packages/crypto/test-vectors.json`), so another implementation, such as a native app, can prove it reads and writes the same bytes. docs/security.md describes the formats.
- Self-hosting on Cloudflare Workers and D1 with Alchemy.
- Breached passwords: logins whose password turned up in data breaches show on the Overview, on the item and in the editor. The check uses Have I Been Pwned's Pwned Passwords, and only the first five characters of each password's SHA-1 hash leave the device. It can be turned off per device in Settings, or for an instance with `VITE_BREACH_CHECK=off`.
- A strict Content-Security-Policy for the web app, which also keeps other sites from showing it in a frame, with the usual security headers alongside.
