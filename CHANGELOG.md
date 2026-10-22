# Changelog

Notable changes to mima. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

The first public version.

### Added

- End-to-end encryption: items, vault names and private keys are encrypted in the browser; the server stores ciphertext and wrapped keys only.
- Workspaces with an owner, admins and members. The first visitor creates the workspace; everyone else joins with a one-time invite link.
- A private vault for everyone, and shared vaults opened to people one by one.
- Logins with one-time codes, API keys, SSH keys and secure notes, with a password generator and strength check.
- Search and a command palette (⌘K) that copies a password without opening the item. Copied secrets clear from the clipboard after 90 seconds.
- An activity log of reveals, copies, shares, imports and backups.
- Import from 1Password, Bitwarden, LastPass, Chrome, Firefox, Safari or any CSV with a password column.
- Settings: change your name, change your master password, choose when mima locks on this device, rename the workspace, and download a decrypted backup.
- Recently deleted: deleted items can be restored for 30 days, and the deletion can be undone from its notification.
- Earlier passwords: a changed password or value stays on the item, encrypted, with when it was replaced and by whom.
- Agents and `mima run`, which hands an item's value to a command without showing it to the caller, with approvals in the web app.
- Layouts for phones, light and dark themes, and installing mima as an app (PWA).
- Self-hosting on Cloudflare Workers and D1 with Alchemy.
