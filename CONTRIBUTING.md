# Contributing to vauly

Thanks for helping. This guide gets you from a clone to a pull request. By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Set up

You need [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/jotyy/vauly.git
cd vauly
bun install
cp apps/server/.env.example apps/server/.env   # set BETTER_AUTH_SECRET to 32+ random characters
cp apps/web/.env.example apps/web/.env
bun run dev
```

`bun run dev` starts the whole stack with Alchemy: the web app on <http://localhost:3001>, the API on <http://localhost:3000>, and a local D1 database. It needs no Cloudflare account. Code changes reload on their own; after adding a migration, stop and start it again so the migration is applied.

`bun run dev:extension` starts the browser extension separately, in a browser of its own. The end-to-end tests build it and load it into Chromium.

## Checks

Run these before you open a pull request. CI runs the same ones.

```sh
bun run check-types     # TypeScript across the monorepo
bunx biome ci .         # lint and formatting (bun run check fixes what it can)
bun run test            # unit tests: crypto, CLI, import and backup
bun run test:e2e        # end-to-end tests in a real browser
```

The end-to-end suite starts its own stack (stage `e2e`, web on port 3101, API on 3100, its own database) next to your dev stack, so it never touches your local data. If it's already running from an earlier run, it's reused. To run a second suite from another checkout at the same time, give it other ports with `VAULY_E2E_PORT`, such as `VAULY_E2E_PORT=3200 bun run test:e2e`. The first time, install the browser with `bunx playwright install chromium` from `e2e/`.

## Where things go

```
apps/web            the React app; pages in src/routes, pieces in src/components, logic in src/lib
apps/server         the Worker entry point
apps/cli            vauly run
packages/crypto     all cryptography; nothing else calls WebCrypto for item data
packages/api        oRPC routes and access rules
packages/db         Drizzle schema and migrations
packages/ui         design tokens (src/styles/globals.css) and shared components
packages/infra      what gets deployed
e2e                 Playwright tests
```

## Conventions

**Encryption.** Anything a person types into an item is encrypted on the device with `packages/crypto` before it's sent. The server stores ciphertext and decides access; it never decrypts. A change to `packages/crypto` needs unit tests, and a change to what the server can see needs an update to [docs/security.md](docs/security.md).

**Access.** Every API route checks access on the server: `memberProcedure` or `adminProcedure`, then `requireVaultAccess` or `requireItemAccess`. Don't rely on the UI hiding something.

**Database.** Change the schema in `packages/db/src/schema`, then generate a migration with a descriptive name:

```sh
cd packages/db && bunx drizzle-kit generate --name item_trash
```

Commit the migration together with the code that needs it. Never edit a migration that's already on `main`.

**UI.**
- Colors, type sizes, radii and shadows come from the tokens in `packages/ui/src/styles/globals.css`. Don't hard-code colors in components.
- Use Tailwind's scale (`h-4`, `gap-2`, `size-5`), not arbitrary values like `h-[1.2rem]`.
- Icons come from [Phosphor](https://phosphoricons.com) (`@phosphor-icons/react`).
- Shared components live in `packages/ui/src/components`; app-only ones in `apps/web/src/components`.
- Check your change in light and dark mode, and at phone width.

**Copy.** Write interface text in plain words that say what happens: "Delete for good", not "Confirm". Use sentence case.

**Tests.** A user-facing change comes with an end-to-end test that does what a person would do. Use made-up data only, like the `example.test` addresses in the existing tests.

## Pull requests

- Keep a pull request to one change, and explain why in the description.
- Add a line under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user or a self-hoster would notice.
- Update the docs in `docs/` when you change how something works.
- Make sure the checks above pass.

Write commit messages as a short summary in the imperative ("Add Recently deleted"), then a blank line and the why, wrapped at 72 characters.

## License

By contributing, you agree that your contributions are licensed under the [GNU AGPL v3.0](LICENSE), the same license as the project.
