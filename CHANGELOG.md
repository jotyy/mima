# Changelog

Notable changes to vauly. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

The first public version.

### Added

- End-to-end encryption: items, vault names and private keys are encrypted in the browser; the server stores ciphertext and wrapped keys only.
- Workspaces with an owner, admins and members. The first visitor creates the workspace; everyone else joins with a one-time invite link.
- Two-step login: a code from an authenticator app after the master password, with ten one-time recovery codes. It works the same in the web app and the browser extension, and admins can reset it for someone who lost their phone.
- A private vault for everyone, and shared vaults opened to people one by one.
- Logins with one-time codes, API keys, SSH keys and secure notes, with a password generator and strength check.
- Share links: send one item to someone outside the workspace through a link that expires after an hour to 30 days, optionally after one view. The copy is encrypted with a key that lives only in the link, and every opening is logged.
- Password health: the Overview lists weak passwords, logins that share a password, and items that someone who lost access could see and that haven't changed since. Each opens a filtered list to fix them.
- Search and a command palette (⌘K) that copies a password without opening the item. Copied secrets clear from the clipboard after 90 seconds.
- An activity log of reveals, copies, shares, imports and backups. Each item shows its own recent activity, and the log can narrow down to one item.
- Import from 1Password, Bitwarden, LastPass, Chrome, Firefox, Safari or any CSV with a password column.
- Settings: change your name, change your master password, choose when vauly locks on this device, rename the workspace, and download a decrypted backup.
- A Get started checklist on the Overview of a new workspace: add items, invite the team, add the browser extension, print the Emergency Kit.
- The Emergency Kit: a printable page with your sign-in address, your email and a blank for your master password, from the checklist or Settings.
- Settings lists the browsers you're signed in on, and can sign out one of them or every other one. A browser signed out this way, or one whose person was removed, drops its keys and returns to sign-in on its next request.
- Recently deleted: deleted items can be restored for 30 days, and the deletion can be undone from its notification.
- Earlier passwords: a changed password or value stays on the item, encrypted, with when it was replaced and by whom.
- Agents and `vauly run`, which hands an item's value to a command without showing it to the caller, with approvals in the web app.
- A browser extension for Chromium browsers that lists the items for the current site, fills login forms and copies usernames, passwords and one-time codes. After you sign in on a site, it offers to save the new login or update a changed password.
- Brand logos for logins and well-known services, in the web app and the extension, from Brandfetch. Only a brand's own domain is looked up, never a subdomain or a private address, and logos can be turned off per device or per instance.
- Layouts for phones, light and dark themes, and installing vauly as an app (PWA).
- Self-hosting on Cloudflare Workers and D1 with Alchemy.
