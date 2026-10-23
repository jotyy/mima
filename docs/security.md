# Security

vauly is built so that the server holding your data can't read it. This page describes how, what the server can still see, and where the model stops protecting you. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Goals

- Someone with the database, or full control of the API, learns no passwords, item names or item contents.
- Your master password never leaves your device, so the server can't leak it.
- People only open the vaults that were shared with them, enforced by cryptography as well as by the API.
- Scripts and agents get the values they're allowed to use, inside the command they run, and nothing else.

## Keys

All cryptography is WebCrypto, implemented once in [`packages/crypto`](../packages/crypto/src/index.ts) and used by the web app and the CLI.

<!-- diagram: KeyChain -->

```
master password ──PBKDF2-SHA256, 600,000 rounds, 16-byte salt──▶ master key
master key ──HKDF-SHA256 "vauly/auth"──▶ auth key  (256 bits, sent to sign in)
master key ──HKDF-SHA256 "vauly/wrap"──▶ wrap key  (AES-256-GCM, never leaves the device)

account key pair   ECDH P-256; the private key is sealed with the wrap key
vault key          AES-256-GCM, one per vault, wrapped to each member's public key
item key           AES-256-GCM, one per item, wrapped with its vault key
```

- **Signing in.** The browser asks for your salt, derives the auth key and uses it as the password for the session. The server stores only a hash of the auth key (Better Auth's default, scrypt). For an email it doesn't know, the server returns a stable made-up salt, so the sign-in page doesn't reveal who has an account.
- **Unlocking.** The wrap key opens your private key. With it the browser unwraps the keys of your vaults, then the keys of their items. All of these stay in memory: reloading the page, choosing **Lock now** or staying idle (15 minutes by default, set per device) forgets them. The session cookie alone opens nothing.
- **Encryption.** Every encrypted value is AES-256-GCM with a fresh random 12-byte IV, stored as `base64(iv).base64(ciphertext)`.
- **Sharing.** To give someone a vault, the browser wraps the vault key to their public key: an ephemeral ECDH P-256 key pair, HKDF-SHA256 bound to the recipient's public key, then AES-256-GCM. Only their private key can open it.
- **Two-step login.** Someone who turns it on must give a six-digit code (RFC 6238: SHA-1, 30 seconds) after their password checks out. The server checks the code, so it keeps the setup key; it accepts one step of clock drift either way and never the same step twice. Without a valid code, the session the password just created is deleted before it's returned. Ten recovery codes, 50 random bits each, are shown once and stored as SHA-256 hashes; each works once. The web app and the browser extension send the code the same way, in an `x-vauly-code` header. Two-step login guards signing in only: it adds nothing to encryption, which still rests on the master password alone.
- **Changing the master password** derives new keys from a fresh salt and seals the same private key with the new wrap key. The server swaps the auth hash and the sealed key in one batch and signs out your other sessions. Your key pair, and so your access to shared vaults, stays the same.

## What the server stores

| Encrypted (the server can't read it)                                                                            | In plain text (the server can read it)                                                  |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Item contents: name, username, password or value, website, one-time code secret, notes, tags, earlier passwords | Email addresses, display names and roles                                                |
| Vault names, descriptions and colors                                                                            | The workspace name                                                                      |
| Your private key                                                                                                | Which vaults exist and who can open each one                                            |
| Vault keys and item keys (wrapped)                                                                              | Item IDs, which vault they're in, ciphertext sizes, revision numbers, timestamps        |
| Share links: the copy of the item they carry (the key is only in the link)                                      | Favorites, and items in Recently deleted                                                |
|                                                                                                                 | Share links: which item, who made them, when they expire and how often they were opened |
| Recovery codes for two-step login (as SHA-256 hashes)                                                           | Two-step login setup keys, so the server can check codes                                |
|                                                                                                                 | The activity log: who did what to which item ID, and when                               |
|                                                                                                                 | Agent names, their public keys, a hash of their token secret, and the commands they ran |
|                                                                                                                 | Public keys of people and agents                                                        |

## Agents and scripts

An agent's key pair is created in the browser. Its private key goes into the token, which is shown once and never stored by vauly; the server keeps the public key and a SHA-256 hash of the token's secret. When a person approves a request, their browser wraps that item's key to the agent's public key. `vauly run` decrypts the item on the machine where it runs, passes the value to the command in its environment, and masks the value in the command's output. See [Agents and scripts](agents.md).

Anyone who holds an agent token can use whatever that agent has been allowed to use. Treat a token like a password, give each agent only the items it needs, and pause or delete agents you no longer use.

## Browser extension

The extension signs in with the same auth key as the web app and keeps the session token in its own storage, sending it as a bearer token. The API accepts sign-ins from `chrome-extension://` and `moz-extension://` origins for this, since each install has its own ID. The unlocked private key is kept only in the extension's session storage, which lives in memory, can't be read by pages or content scripts, and is cleared when the browser closes or after 15 idle minutes. Filling runs a small script in the page only when you choose a login to fill. The fill menu and the save prompt shown on a site are iframes of the extension's own page, which the site can't read; they list only logins saved for that site and never receive a password. To offer saving new logins, a content script on each page reads the username and password of a sign-in form when it's submitted and hands them to the extension, which keeps them in session storage for that tab for five minutes at most. Submissions on your vauly server's own pages are dropped, so the master password is never held. See [Browser extension](browser-extension.md).

## Share links

A share link shows one item to someone outside the workspace. The sender's browser copies the item's username, password or value, website, notes and, only if asked, its one-time code secret, then encrypts the copy with a new AES-256-GCM key. The server stores the ciphertext under a random link ID. The key goes into the link's `#fragment`, which browsers never send to a server, so the link ID alone opens nothing.

The recipient's page asks the server for the ciphertext only after they choose **Show the item**, which keeps link previews in chat apps from using up a one-view link. The server counts each opening in the same statement that checks the link's limits, refuses links that expired, were used up, or whose item is in Recently deleted, and records each opening in the activity log. Anyone who can open the item can see its links and turn them off.

A link is a copy: changing the item later doesn't change what the link shows, and anyone holding the full link can open it until it stops working. Send it the way you'd send the password itself.

## Website logos

To show a brand's logo next to an item, the browser loads an image from Brandfetch's CDN for that brand's domain. Only the registrable domain is used (`hubspot.com` for `app.hubspot.com`), never a subdomain, and never an IP address or a private network name such as `.local`, `.internal` or `.corp`. Items without a website get a logo only when their name matches a short list of well-known services. Brandfetch requires a `Referer`, so it also sees the address of your vauly, along with your IP address, like any image request. It learns nothing else about the item. Turn logos off per device in **Settings → Website logos**, or for a whole instance by deploying with `VITE_BRANDFETCH_CLIENT_ID=off`.

## How the app is served

The web app's pages come with a Content-Security-Policy that runs only the app's own script files: no inline scripts, nothing evaluated from a string, nothing from another site. The pages can connect only to your vauly API, and load images only from the app itself and, while logos are on, Brandfetch's CDN. If a bug ever let someone slip markup into a page, the browser would neither run their script nor send what it read anywhere else. The app also refuses to be shown in a frame (`frame-ancestors 'none'`, and `X-Frame-Options: DENY` for older browsers), so another site can't hide it under a page of its own and trick you into clicking **Reveal** or **Share**. The build writes these headers to a `_headers` file, which Cloudflare applies in both ways of deploying; see [`apps/web/security-headers.ts`](../apps/web/security-headers.ts).

## Limits

These are the things vauly does not protect against. Please read them before you rely on it.
- **The server delivers the app.** vauly runs in the browser, and the browser loads its code from your instance. Someone who controls the web app's hosting could ship code that captures your master password the next time you sign in. This holds for every web-based end-to-end encrypted app, and the Content-Security-Policy can't help, since the same hosting serves the policy. Host vauly yourself, keep your Cloudflare account secure, and limit who can deploy to it.
- **Removing someone doesn't take back what they've seen.** Taking a person out of a vault deletes their copy of its key, so they can't open it through vauly again. But they may have copied passwords, or the vault key, while they had access. Change the passwords that matter after someone leaves: the Overview lists the items they could see that haven't changed since.
- **Nobody can reset a master password.** It is the only key to your private key. If you forget it, your items can't be recovered by you, an admin or the server. An admin can invite you again so you start over.
- **A compromised device is out of scope.** Malware on your computer can read what you can read while vauly is unlocked.
- **One-time codes live next to passwords.** Storing a TOTP secret in the same item as the password is convenient, but it means the item alone is enough to sign in.
- **Metadata isn't hidden.** See the table above: the server knows who is in the workspace, who can open which vault, and when items are used.
- **No independent audit yet.** The design is small and the code is open, but it hasn't been reviewed by a third party.
