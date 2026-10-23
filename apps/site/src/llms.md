# vauly

> vauly is an open-source, end-to-end encrypted password manager for small teams, from two people to a handful, and for the coding agents and scripts they work with. Each team runs its own copy on its own Cloudflare account.

Key facts:
- Free and open source under AGPL-3.0. There is no paid plan and no hosted vauly: a team deploys it to its own Cloudflare account, as one Worker with a D1 database, with the Deploy to Cloudflare button. A small team fits in Cloudflare's free plan.
- Every item is encrypted on the device before it's saved, so the server never sees the master password or anything inside an item, not even its name. Keys come from the master password with PBKDF2 (600,000 rounds), items are encrypted with AES-256-GCM, and vault keys reach other people through ECDH P-256 key pairs.
- It holds logins with one-time codes (TOTP), API keys, SSH keys and notes. Everyone has a private vault, and shared vaults are opened to people one by one.
- The browser extension fills and saves logins in Chrome, Edge, Brave, Arc and other Chromium browsers. It isn't in a store yet.
- `vauly run` hands a secret to a command, so coding agents, scripts and CI jobs can use it without seeing it. A person approves each item once.
- It imports CSV exports from 1Password, Bitwarden, LastPass, Chrome, Firefox and Safari, and downloads a decrypted backup any time.
- Nobody can reset a forgotten master password, not even an admin.
- It hasn't had an independent security audit yet. There are no native mobile or desktop apps, though the web app works on phones and installs as an app (PWA), and it doesn't hold passkeys.
- Compared with 1Password and Bitwarden: https://vauly.app/docs/compare.md
- A live demo anyone can sign in to, with an example team that comes back every hour: https://demo.vauly.app
- Website: https://vauly.app. Source code: https://github.com/jotyy/vauly.
