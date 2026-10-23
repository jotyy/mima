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
- **Unlocking.** The wrap key opens your private key. With it the browser unwraps the keys of your vaults, then the keys of their items. All of these stay in memory: reloading the page, choosing **Lock now** or staying idle (15 minutes by default, set per device) forgets them. The session cookie alone opens nothing. A device can also unlock with a passkey instead of the master password; see [Unlocking with a passkey](#unlocking-with-a-passkey).
- **Encryption.** Every encrypted value is AES-256-GCM with a fresh random 12-byte IV, stored as `base64(iv).base64(ciphertext)`.
- **Sharing.** To give someone a vault, the browser wraps the vault key to their public key: an ephemeral ECDH P-256 key pair, HKDF-SHA256 bound to the recipient's public key, then AES-256-GCM. Only their private key can open it.
- **Roles in a vault.** Each person can view, edit or manage a shared vault. The server enforces the role: it refuses changes to items, share links and agent access from someone who can only view, and changes to who can open the vault from anyone but its managers. Viewers don't see the vault's share links, agents' requests and grants, or their activity: a link's ID alone would let them use up a one-view link. A vault always keeps a manager; changes that would remove the last one are refused in the same database statement that makes them. Cryptography can't make the difference, since reading a vault takes its key, and the key would let someone encrypt new items too. A viewer who wanted to could keep what they read, as anyone with access could.
- **Two-step login.** Someone who turns it on must give a six-digit code (RFC 6238: SHA-1, 30 seconds) after their password checks out. The server checks the code, so it keeps the setup key; it accepts one step of clock drift either way and never the same step twice. Without a valid code, the session the password just created is deleted before it's returned. Ten recovery codes, 50 random bits each, are shown once and stored as SHA-256 hashes; each works once. The web app and the browser extension send the code the same way, in an `x-vauly-code` header. Two-step login guards signing in only: it adds nothing to encryption, which rests on the master password, and, on a device where you turn it on, on a passkey there too (see [Unlocking with a passkey](#unlocking-with-a-passkey)).
- **Changing the master password** derives new keys from a fresh salt and seals the same private key with the new wrap key. The server swaps the auth hash and the sealed key in one batch and signs out your other sessions. Your key pair, and so your access to shared vaults, stays the same.

## Formats

Another implementation, such as a native app, must produce exactly these bytes. [`packages/crypto/test-vectors.json`](../packages/crypto/test-vectors.json) has made-up inputs and the expected output of each step below, intermediate values included, and the unit tests check `packages/crypto` against it. `bun run vectors` in `packages/crypto` regenerates the file from the formats as described here.
- **Text.** Bytes are standard base64 with padding, unless noted. The auth key is lowercase hex.
- **Master keys.** The password is normalized to NFKC and encoded as UTF-8. PBKDF2-HMAC-SHA256 with the account's salt (16 random bytes, stored as `kdfSalt`) and `kdfIterations` (600,000) gives a 32-byte master key. HKDF-SHA256, with 32 zero bytes as salt and the ASCII info `vauly/auth` or `vauly/wrap`, turns it into the 32-byte auth key and the wrap key.
- **Sealed values.** AES-256-GCM with a random 12-byte IV, no additional data and a 16-byte tag after the ciphertext, written as `base64(iv) + "." + base64(ciphertext ‖ tag)`. An item is the UTF-8 JSON of its fields, sealed with its item key.
- **Data keys.** Vault and item keys are 32 random bytes. A key wrapped with another key is those 32 bytes, sealed.
- **Key pairs.** ECDH on P-256. Public keys are DER SubjectPublicKeyInfo; private keys are DER PKCS#8. The account's PKCS#8 private key, sealed with the wrap key, is `encryptedPrivateKey`.
- **Wrapping to a public key.** A fresh P-256 key pair, then ECDH with the recipient's public key (the 32-byte x coordinate). HKDF-SHA256, with 32 zero bytes as salt and the info `vauly/share:` followed by the recipient's public key in base64, gives an AES-256-GCM key. The result is `base64(ephemeral public key) + ":" + ` the data key sealed with it.
- **Share links.** The link key is 32 bytes in base64url without padding, after the `#`.
- **Agent tokens.** `vauly_agent_<id>.<secret>.<private key>`: the secret is 24 random bytes in hex, and the private key is PKCS#8 in base64 with `+` and `/` replaced by `-` and `_` (padding kept). The server stores the SHA-256 of the secret, in hex.
- **One-time codes.** RFC 6238 with base32 setup keys, or `otpauth://` links.
- **Device copies.** The key is HKDF-SHA256 of the passkey's 32-byte PRF output, with the server's 32-byte pepper as salt and the info `vauly/device`. It seals the PKCS#8 private key with the additional data `vauly/device`, the account ID, the passkey's ID (base64url) and the public key, each on a line of its own. The pepper is HMAC-SHA256 of `device:<session ID>:<issued at, in milliseconds>`, keyed with the server's secret.
- **Offline copies.** A JSON object of the vaults list, the items list (both as the API returns them) and the profile, sealed like any other value with a new 32-byte key. That key is wrapped to the account's own public key the way a vault key is wrapped to a member's. Stored beside it, in the clear: the account ID, the session ID, when it was synced, and the account's KDF salt, iteration count, public key and sealed private key.

## What the server stores

| Encrypted (the server can't read it)                                                                            | In plain text (the server can read it)                                                  |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Item contents: name, username, password or value, website, one-time code secret, notes, tags, earlier passwords | Email addresses, display names and roles                                                |
| Vault names, descriptions and colors                                                                            | The workspace name                                                                      |
| Your private key                                                                                                | Which vaults exist, who can open each one and their role in it                          |
| Vault keys and item keys (wrapped)                                                                              | Item IDs, which vault they're in, ciphertext sizes, revision numbers, timestamps        |
| Share links: the copy of the item they carry (the key is only in the link)                                      | Favorites, and items in Recently deleted                                                |
|                                                                                                                 | Share links: which item, who made them, when they expire and how often they were opened |
| Recovery codes for two-step login (as SHA-256 hashes)                                                           | Two-step login setup keys, so the server can check codes                                |
|                                                                                                                 | The activity log: who did what to which item ID, and when                               |
|                                                                                                                 | Agent names, their public keys, a hash of their token secret, and the commands they ran |
|                                                                                                                 | Public keys of people and agents                                                        |

## Unlocking with a passkey

On a device where you turn on **Settings › Unlock with this device**, vauly unlocks with Face ID, Touch ID, Windows Hello or the device's PIN instead of the master password, for 14 days at a time. It works only in browsers whose passkeys support the WebAuthn PRF extension, and vauly doesn't offer it anywhere else.
- **Turning it on** asks for the master password first. Then the browser creates a passkey for your vauly's address, which needs the device to verify you. Given a random 32-byte salt, the passkey's PRF extension returns a secret that only that passkey can produce, and only after that check. The server adds a pepper: an HMAC, under its own secret, of this session and of when the copy was made. HKDF-SHA256 turns the two into an AES-256-GCM key, which seals a copy of your private key. The copy's additional data names the account, the passkey and the public key, so it opens for nothing else, and the key inside is checked against your public key before it's used.
- **This device keeps** the sealed copy, the passkey's ID, the salt, your public key, the session's ID and when the copy was made, in IndexedDB. The PRF secret, the pepper and the key made from them are never stored. The server never sees the passkey or anything it produces, and it keeps nothing new: it can recompute the pepper, but without the passkey that opens nothing.
- **Unlocking** asks for the passkey, then for the pepper, which the server hands out only inside the session the copy was made in, and only for 14 days after it was made. It happens only on the unlock screen. Signing in on a device still needs the master password.
- **Ending it.** Once the session ends, by a sign-out here or on another device, by **Settings › Where you're signed in**, by an admin removing you or by the session running out, the server can't give the pepper any more, so the copy can't be opened, even by someone who copied the device's storage. After 14 days the server refuses it as well. Separately, the device deletes the copy when it next starts without that session, when you turn it off, sign out or change your master password there, and when a copy fails to open.

On that device, for those 14 days, the passkey stands in for the master password: someone who has the device, or a copy of its storage while the session lasts, and who can pass its check (your face, your fingerprint, or the device's PIN or password) can unlock. If the passkey syncs, as in iCloud Keychain or Google Password Manager, so can someone who controls that account and also has the device's storage while the session lasts. Your key pair never changes, not even with a new master password, so what someone opens that way stays open to them; sign the session out to end it. Turn this on only on devices whose PIN or password you keep to yourself.

## Offline copy

So the installed app can open items without a connection, each device keeps a copy of what the API last returned for you: your vaults with their wrapped keys, and your items' ciphertext. Members, activity and share links aren't kept. Turn it off under **Settings › Offline copy**, which deletes it.
- **It's sealed whole**, with a key wrapped to your own public key, so even its item and vault IDs and timestamps need your master password. Only what unlocking needs stays readable: the KDF salt and iteration count and your sealed private key, the same as the server keeps, with your account and session IDs and when it was synced. Nothing decrypted is ever written to storage.
- **Offline, it's read-only.** The master password unlocks it; unlocking with a passkey needs the server, so it doesn't work offline. Adding, editing, sharing and approvals wait for a connection, and copies and reveals made offline aren't recorded in the activity log.
- **It belongs to the session it was made in.** The device deletes it when it next starts without that session, after any sign-out from this device or another, or a removal, and when you sign out, change your master password there or turn it off. Every sync rewrites it from what the API returns, so a vault you lose access to leaves it then.
- **It's used for 30 days at most** after its last sync, then deleted. That limit is enforced by the app, not by cryptography: a device offline has no trusted clock.

## Agents and scripts

An agent's key pair is created in the browser. Its private key goes into the token, which is shown once and never stored by vauly; the server keeps the public key and a SHA-256 hash of the token's secret. When a person approves a request, their browser wraps that item's key to the agent's public key. `vauly run` decrypts the item on the machine where it runs, passes the value to the command in its environment, and masks the value in the command's output. See [Agents and scripts](agents.md).

Anyone who holds an agent token can use whatever that agent has been allowed to use. An agent stops working when the person who created it leaves the workspace, and loses its grants in a vault when they lose that vault. Treat a token like a password, give each agent only the items it needs, and pause or delete agents you no longer use.

## Browser extension

The extension signs in with the same auth key as the web app and keeps the session token in its own storage, sending it as a bearer token. The API accepts sign-ins from `chrome-extension://` and `moz-extension://` origins for this, since each install has its own ID. The unlocked private key is kept only in the extension's session storage, which lives in memory, can't be read by pages or content scripts, and is cleared when the browser closes or after 15 idle minutes. Filling runs a small script in the page only when you choose a login to fill. The fill menu and the save prompt shown on a site are iframes of the extension's own page, which the site can't read; they list only logins saved for that site and never receive a password. To offer saving new logins, a content script on each page reads the username and password of a sign-in form when it's submitted and hands them to the extension, which keeps them in session storage for that tab for five minutes at most. Submissions on your vauly server's own pages are dropped, so the master password is never held. See [Browser extension](browser-extension.md).

## Share links

A share link shows one item to someone outside the workspace. The sender's browser copies the item's username, password or value, website, notes and, only if asked, its one-time code secret, then encrypts the copy with a new AES-256-GCM key. The server stores the ciphertext under a random link ID. The key goes into the link's `#fragment`, which browsers never send to a server, so the link ID alone opens nothing.

The recipient's page asks the server for the ciphertext only after they choose **Show the item**, which keeps link previews in chat apps from using up a one-view link. The server counts each opening in the same statement that checks the link's limits, refuses links that expired, were used up, or whose item is in Recently deleted, and records each opening in the activity log. Anyone who can open the item can see its links and turn them off.

A link is a copy: changing the item later doesn't change what the link shows, and anyone holding the full link can open it until it stops working. Send it the way you'd send the password itself.

## Website logos

To show a brand's logo next to an item, the browser loads an image from Brandfetch's CDN for that brand's domain. Only the registrable domain is used (`hubspot.com` for `app.hubspot.com`), never a subdomain, and never an IP address or a private network name such as `.local`, `.internal` or `.corp`. Items without a website get a logo only when their name matches a short list of well-known services. Brandfetch requires a `Referer`, so it also sees the address of your vauly, along with your IP address, like any image request. It learns nothing else about the item. Turn logos off per device in **Settings → Website logos**, or for a whole instance by deploying with `VITE_BRANDFETCH_CLIENT_ID=off`.

## Breached passwords

To find passwords that turned up in data breaches, the browser asks Have I Been Pwned's [Pwned Passwords](https://haveibeenpwned.com/API/v3#PwnedPasswords) with k-anonymity. It works out the password's SHA-1 hash and sends only the first five hex characters. The service answers with every leaked hash that starts with them, about a thousand, padded with made-up entries so the answer's size gives nothing away, and the browser looks for the rest of the hash in that list. Have I Been Pwned never sees a password or a whole hash: the five characters it gets are shared by about a thousand leaked passwords, and by countless others. The requests carry no cookies and no `Referer`, so they don't say which vauly asked. Answers are kept in memory until vauly locks. Turn the check off per device in **Settings → Breached passwords**, or for a whole instance by deploying with `VITE_BREACH_CHECK=off`.

## How the app is served

The web app's pages come with a Content-Security-Policy that runs only the app's own script files: no inline scripts, nothing evaluated from a string, nothing from another site. The pages can connect only to your vauly API and, while the breach check is on, Have I Been Pwned, and load images only from the app itself and, while logos are on, Brandfetch's CDN. If a bug ever let someone slip markup into a page, the browser would neither run their script nor send what it read anywhere else. The app also refuses to be shown in a frame (`frame-ancestors 'none'`, and `X-Frame-Options: DENY` for older browsers), so another site can't hide it under a page of its own and trick you into clicking **Reveal** or **Share**. The build writes these headers to a `_headers` file, which Cloudflare applies in both ways of deploying; see [`apps/web/security-headers.ts`](../apps/web/security-headers.ts).

## Limits

These are the things vauly does not protect against. Please read them before you rely on it.
- **The server delivers the app.** vauly runs in the browser, and the browser loads its code from your instance. Someone who controls the web app's hosting could ship code that captures your master password the next time you sign in. This holds for every web-based end-to-end encrypted app, and the Content-Security-Policy can't help, since the same hosting serves the policy. Host vauly yourself, keep your Cloudflare account secure, and limit who can deploy to it.
- **A device that stays offline keeps its offline copy.** Signing a session out, removing someone or changing the master password reaches a device only when it next connects. Until then, someone with that device and the master password (an old one too, since the key pair doesn't change) can read the items it held at its last sync. Turn the offline copy off on devices you might lose.
- **Deleting an account deletes what only it could open.** Someone who deletes their account takes their private vault and agents with them, and any shared vault nobody else could open; those are gone for everyone, as nobody holds their keys anymore. Shared vaults others can open stay, and the activity log keeps their name. See [Self-hosting](self-hosting.md#when-someone-deletes-their-account).
- **Removing someone doesn't take back what they've seen.** Taking a person out of a vault deletes their copy of its key, so they can't open it through vauly again. But they may have copied passwords, or the vault key, while they had access. Change the passwords that matter after someone leaves: the Overview lists the items they could see that haven't changed since.
- **Nobody can reset a master password.** It, and for up to 14 days a passkey on a device where you turned that on, are the only keys to your private key. If you forget the master password, your items can't be recovered by you, an admin or the server. An admin can invite you again so you start over.
- **A compromised device is out of scope.** Malware on your computer can read what you can read while vauly is unlocked.
- **One-time codes live next to passwords.** Storing a TOTP secret in the same item as the password is convenient, but it means the item alone is enough to sign in.
- **Metadata isn't hidden.** See the table above: the server knows who is in the workspace, who can open which vault, and when items are used.
- **No independent audit yet.** The design is small and the code is open, but it hasn't been reviewed by a third party.
