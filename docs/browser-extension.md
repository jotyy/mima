# Browser extension

The extension shows the items for the site you're on, fills the login form with one click, copies usernames and passwords, and offers to save the logins you type. It decrypts on your computer, like the web app, and works in Chrome, Edge, Brave, Arc and other Chromium browsers.

## Install

The extension isn't in a store yet, so you build it from this repository and load it unpacked:

```sh
bun install
bun run --cwd apps/extension build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and pick `apps/extension/.output/chrome-mv3`.
3. Pin mima to the toolbar.

A Firefox build exists (`bun run --cwd apps/extension build:firefox`), but it isn't tested yet.

## Connect and sign in

Open the extension and enter the address you open mima at, such as `mima.example.com`. The extension finds your server from there. Then sign in with your email and master password.

## Use it

- **On a login page**, click into the email or password field and mima's menu opens under it with the logins saved for that site. Choose one to fill the form. If the login has a one-time code, filling also copies the current code, ready to paste on the next step. Typing, Escape or a click elsewhere closes the menu. When the extension is locked or not signed in yet, the menu offers to do that first.
- **In the extension**, the items saved for the site you're on come first, with a **Fill** button.
- **After you sign in somewhere new**, mima asks in the top corner of the page whether to save the login, and to which vault; the mima icon shows a badge too, and the extension offers the same. Choose **Not now** to let it go. If you signed in to a saved login with a different password, it offers to update the password instead, and the old one stays under Earlier passwords. Logins you already saved, and anything typed into mima itself, are never offered.
- **Search** to find any item; the buttons copy its username, password or one-time code.
- **Lock** forgets the key. The extension also locks itself after 15 idle minutes, and whenever the browser closes.

Fills and copies appear in **Activity**, like everything else.

## What it can access

The extension asks to read and change data on all sites. It needs that to fill forms on whatever site you're on, to notice a login being submitted so it can offer to save it, and to reach your mima server, whose address is different for every team. On each page, a small script watches for a sign-in form being sent and passes the username and password to the extension. The menu and the save prompt it adds to a page are frames of the extension's own page, so the site can't read the logins listed in them, and they never hold a password: filling and saving happen in the extension itself. The script changes the page's fields only when you choose a login to fill.

What it stores:

| Where                                                          | What                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| Extension storage (on disk)                                    | Your mima address, your email and the session token  |
| Session storage (memory only, cleared when the browser closes) | Your unlocked private key and when you last used it  |
| Session storage, per tab, for 5 minutes                        | A login you just typed, until you save or dismiss it |

Your master password is never stored. Pages and other extensions can't read the extension's storage.
