# Contributing to Viby

Thanks for taking the time to make Viby better.

## Before you start

- Open an issue before starting a new feature, a refactor or a dependency change. It saves you from building something that doesn't fit.
- Small bug fixes and documentation improvements can go straight to a pull request.
- By contributing, you agree that your work is licensed under the project's Apache-2.0 license.

## Set up

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run runtime   # fetch the pinned playback runtime (once)
npm run dev
```

Packaging:

```bash
npm run dist:mac
npm run dist:win
```

## Tests

[TESTING.md](TESTING.md) maps changed files to the suites that matter. Run the targeted suites for what you touched; run everything before a release or when you change a shared contract.

At minimum:

```bash
npm run typecheck
npm run build
```

The end-to-end runs use the real app and play audio muted. They need a desktop session.

## Style

- TypeScript and Svelte 5 (runes). Keep types honest; avoid `any`.
- Match the existing UI: monochrome, restrained motion, no new accent colours.
- Prefer the existing components and helpers over new abstractions.
- New runtime dependencies need a clear reason and a discussion first.
- Comments should explain *why*, not *what*.

## Rules

- No ads, paywalls, tracking, analytics or telemetry. Accounts are optional and exist only for backup and sync — never to unlock playback.
- No bundled credentials, cookies, tokens, signing keys or downloaded media.
- Keep user data local; don't add network calls that aren't needed for a feature the user asked for.
- Don't commit `.env` files, `resources/python/`, caches or build output.
- One concern per pull request. Include screenshots for UI changes.
- Be civil. Harassment, bigotry and bad-faith behaviour are not welcome.

## Pull requests

A good PR:

1. Explains the problem and the approach.
2. Stays focused.
3. Includes the tests you ran.
4. Updates documentation when behaviour changes.
5. Doesn't mix formatting churn with functional changes.
