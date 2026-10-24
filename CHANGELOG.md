# Changelog

Notable changes to vauly. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Fixed

- The service worker is the same wherever the web app is built, so `vauly verify --against` a release's manifest matches every instance of that release. It used to list its files in the order the build machine's file system gave them. CI now builds the app on macOS as well as Linux and compares.

## 0.1.0 - 2026-10-23

The first public version. If you deployed vauly before October 24, 2026, read [Updating vauly](docs/updating.md) first: update the browser extension with the server, and add one line to your `wrangler.jsonc`.

### Added

- End-to-end encryption: items, vault names and private keys are encrypted in the browser; the server stores ciphertext and wrapped keys only.
- Master passwords go through Argon2id (64 MiB, three passes), in a key worker whose policy is the only one that lets WebAssembly run. Accounts made with PBKDF2 move over the next time they sign in or unlock with the master password in the web app. Update the browser extension along with the server: an older one can't unlock an account that has moved. The apps refuse key derivation settings weaker than vauly allows, whatever the server asks for.
- Workspaces with an owner, admins and members. The first visitor creates the workspace; everyone else joins with a one-time invite link.
- Two-step login: a code from an authenticator app after the master password, with ten one-time recovery codes. It works the same in the web app and the browser extension, and admins can reset it for someone who lost their phone.
- A private vault for everyone, and shared vaults opened to people one by one. Each person can view, edit or manage a shared vault: viewers open, copy and fill items; editors also change them and share them by link or with agents; managers also choose who can open the vault. Existing access becomes manage.
- Logins with one-time codes, API keys, SSH keys and secure notes, with a generator and a strength check. The generator makes random characters or passphrases of 4 to 8 words from the EFF's large wordlist, shows their strength in bits, and remembers its settings on each device; creating or changing a master password offers a six-word passphrase. The strength check counts a passphrase's words as words, not as random letters.
- Custom fields on any item, such as an account number or a PIN, optionally hidden like a password, and more than one website per login; the extension fills on any of them. Imports from 1Password, Bitwarden, KeePass, Proton Pass and Enpass bring fields and extra websites across as such, hidden ones hidden, and backups keep them.
- Share links: send one item to someone outside the workspace through a link that expires after an hour to 30 days, optionally after one view. The copy is encrypted with a key that lives only in the link, and every opening is logged.
- Password health: the Overview lists weak passwords, logins that share a password, and items that someone who lost access could see and that haven't changed since. Each opens a filtered list to fix them.
- Payment cards and identities. A card keeps its cardholder, number, expiry, security code and PIN, shows its brand, and warns about a mistyped number; an identity keeps a name, company, email, phone, address, and tax and registration numbers. Numbers, codes, PINs and tax numbers are masked like passwords, every reveal and copy is logged, and search never matches them. Imports from 1Password (1PUX), Bitwarden (JSON), Proton Pass, Enpass, Keeper (JSON) and Dashlane (ZIP) bring them across, passport and licence numbers as hidden fields; backups and share links carry them; and the browser extension fills them into checkout and address forms.
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
- A GitHub Action, `jotyy/vauly/action`, that installs the CLI from a release (checked against its SHA256SUMS) and runs a step under `vauly run`, or exports values to later steps masked in the log. It needs only `VAULY_SERVER` and `VAULY_TOKEN` in GitHub's secrets, and a workflow in CI checks that the values never reach the job's log.
- `vauly mcp`: an MCP server for coding agents, with tools that list what a project can use, run a command with the values masked in its output, and ask a person for access. No tool returns a value.
- A browser extension for Chromium browsers that lists the items for the current site, fills login forms and copies usernames, passwords and one-time codes. After you sign in on a site, it offers to save the new login or update a changed password, in a window of its own beside the page. What it adds to a site's page looks the same whatever the vaults hold.
- Passkeys in the browser extension: when a site offers to create one, vauly asks in a window of its own and saves it in a vault you choose, or in the login saved for that account, and signs in with it later; **Use another way** leaves it to the browser. The window asks for the master password when it wasn't entered in the last few minutes, and it can be told not to ask on a site; the extension's settings turn it off everywhere. The page's origin comes from the browser, a passkey works only for the site it was made for, its private key is sealed with the vault's key so agents given the item can't use it, and every sign-in is logged. The web app shows the passkey on its item and keeps it through edits and moves.
- Brand logos for logins and well-known services, in the web app and the extension, from Brandfetch. Only a brand's own domain is looked up, never a subdomain or a private address, and logos can be turned off per device, in the extension's settings too, or per instance.
- Layouts for phones, light and dark themes, and installing vauly as an app (PWA).
- `vauly verify <url>` checks that an instance serves exactly the web app its commit builds: every file, the page and its security headers. The web build is reproducible (CI builds it twice and compares), every build publishes `/.well-known/vauly-build.json`, and the app reads its instance settings from `/vauly.json` at runtime, so the code is the same for every instance.
- Offline: the installed app keeps an encrypted copy of your vaults and items and opens them without a connection, read-only, for up to 30 days after the last sync. The copy is sealed whole with a key only your private key opens, belongs to the session it was made in, and can be turned off per device.
- Unlock with a passkey: Face ID, Touch ID, Windows Hello or the device's PIN instead of the master password, turned on per device in Settings, for 14 days at a time. A copy of the private key is sealed with a key made from the passkey's PRF output and a pepper the server gives only inside the session the copy was made in, and it's kept on that device only.
- Test vectors for the cryptography (`packages/crypto/test-vectors.json`), so another implementation, such as a native app, can prove it reads and writes the same bytes. docs/security.md describes the formats.
- Self-hosting on Cloudflare Workers and D1 with Alchemy.
- Breached passwords: logins whose password turned up in data breaches show on the Overview, on the item and in the editor. The check uses Have I Been Pwned's Pwned Passwords, and only the first five characters of each password's SHA-1 hash leave the device. It can be turned off per device in Settings, or for an instance with `VITE_BREACH_CHECK=off`.
- A strict Content-Security-Policy for the web app, which also keeps other sites from showing it in a frame, with the usual security headers alongside.
