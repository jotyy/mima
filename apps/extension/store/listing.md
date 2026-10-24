# Chrome Web Store listing

Everything the Chrome Web Store dashboard asks for, ready to paste. The images next to this file are made by `bun run store` in `e2e/`; the package to upload comes from `bun run --cwd apps/extension zip`.

## Store listing

**Name** (from the manifest): vauly: Password Manager for Teams

**Summary** (from the manifest, 132 characters at most):

> Fill and save your team's logins and passkeys from vauly, the open-source, end-to-end encrypted password manager you host yourself.

**Description:**

```
vauly is an open-source, end-to-end encrypted password manager for small teams. Your team runs its own vauly on its own Cloudflare account, and this extension brings it into your browser.

What it does:
• Shows the logins saved for the site you're on, and fills the sign-in form in one click.
• After you sign in somewhere new, offers to save the login to a vault you choose, or to update a password you changed.
• Saves passkeys in your vaults and signs in with them, in a window of its own that sites can't see or click.
• Copies usernames, passwords and one-time codes.
• Searches every item you can open, across your vaults.

How your data is kept:
• Everything is decrypted on your computer. Your master password never leaves it, and the server only ever holds ciphertext.
• The extension talks to the vauly server you connect it to, your team's own. It sends nothing to us and has no analytics.
• Brand logos next to logins come from Brandfetch, looked up by the website's domain.

What you need: a vauly server. Deploy your own in one click from https://vauly.app, or try the shared demo at https://demo.vauly.app.

vauly is open source under AGPL-3.0: https://github.com/jotyy/vauly
```

**Category:** Privacy & Security

**Language:** English

**Graphic assets** (in this folder):
- Store icon: comes from the package, `icon/128.png`.
- Screenshots, 1280×800: `screenshot-1.png` to `screenshot-5.png`.
- Small promo tile, 440×280: `promo-small.png`.
- Marquee promo tile, 1400×560: `promo-marquee.png`.

**Homepage URL:** https://vauly.app

**Support URL:** https://github.com/jotyy/vauly/issues

**Official URL:** optional. It lists only sites verified as yours in Google Search Console. To use vauly.app, verify it there first with a DNS record.

**Mature content:** off.

## Privacy practices

**Single purpose:**

> Fill, save and sign in with the logins and passkeys stored in the user's own vauly password manager.

**Permission justifications:**

| Permission                      | Justification                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                       | Keeps the address of the user's vauly server, their session and their settings. While vauly is unlocked, it keeps the decrypted key in session storage, which lives in memory and is cleared when vauly locks or the browser closes.                                                                       |
| `scripting`                     | Fills the login form on the current page when the user chooses a login, and reads that form after the user signs in so the extension can offer to save it.                                                                                                                                                 |
| `alarms`                        | Locks vauly after the idle time the user chose, and clears expired passkey requests.                                                                                                                                                                                                                       |
| Host permissions (`<all_urls>`) | A password manager has to work on whatever site the user signs in to. The extension shows the logins saved for the current site, fills its login form, offers to save new logins and handles its passkey requests. It also reaches the user's own vauly server, whose address is different for every team. |

**Are you using remote code?** No. All of the extension's code is in the package.

**Data usage**, what the extension handles:
- **Personally identifiable information:** yes. The user's email address, to sign in, and the usernames saved in their logins.
- **Authentication information:** yes. Passwords, one-time codes and passkeys, stored encrypted in the user's own vauly. The master password is used on the device and never sent.
- **Website content:** yes. The login form on the page the user is on, to fill it and to offer to save what was typed.
- **Health, financial and payment information, personal communications, location, web history, user activity:** no.

**Certifications:** tick all three:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://vauly.app/docs/privacy/

## Test instructions (for reviewers)

```
The extension needs a vauly server. Use the public demo, which anyone can sign in to and which goes back to its starting state every hour:

1. Open the extension and enter demo.vauly.app as the address.
2. Sign in with alex@acme.example and the master password keyhole-river-demo-42. The demo's sign-in page shows the same account.
3. Fill: open https://github.com/login. Click into the username field, choose the vauly mark, and choose "GitHub" to fill the form.
4. Save: on https://the-internet.herokuapp.com/login, sign in with tomsmith and SuperSecretPassword!, the test login that page shows. vauly offers to save it; choose a vault and Save.
5. Passkeys: on https://webauthn.io, register a passkey. vauly's window asks where to save it (the master password above, if asked). Then authenticate on the same site, and choose the saved passkey.

On the demo, changing the master password, two-step login and a few other account settings are turned off, so the next visitor can sign in.
```

## Distribution

- **Visibility:** Public.
- **Regions:** All regions.

## Your developer account

- Register at https://chrome.google.com/webstore/devconsole and pay the one-time US$5 fee.
- Turn on 2-Step Verification for the Google account: publishing requires it.
- Verify the contact email address.
- Trader or non-trader (EU Digital Services Act): decide for yourself. A free, non-commercial open-source project is usually non-trader. A trader has to publish a legal name, address and phone number.
