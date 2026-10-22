# Contributing to Viby

Thanks for taking the time to make Viby better.

Commit messages, versioning, release and CI rules live in
[CIRULES.md](CIRULES.md). Read it before your first commit; deviations need a
reason in the PR.

## Before you start

- Open an issue before starting a new feature, a refactor or a dependency change. It saves you from building something that doesn't fit.
- Small bug fixes and documentation improvements can go straight to a pull request.
- By contributing, you agree that your work is licensed under the project's Apache-2.0 license.

## Set up

Requirements: Node.js 22.12+ (required by Electron 45) and npm.

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

## Releases

Pushing a `v*` tag builds macOS (Intel + Apple Silicon) and Windows and
publishes everything to a GitHub Release for that tag via
[`.github/workflows/release.yml`](.github/workflows/release.yml).

1. Bump `version` in `package.json` and commit — it must match the tag.
2. Run the relevant tests, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

No secrets to configure: the workflow uses the repository's built-in
`GITHUB_TOKEN`. If publishing fails with 403, set Actions → General →
Workflow permissions to "Read and write".

The workflow first creates the release as a draft, both platform jobs then
upload into it, and the release publishes only when every platform finishes —
so a half-built release is never public. If a platform job fails mid-run,
re-run just that job; everything uploads into the existing draft and the
release goes live when it succeeds. Re-running the whole workflow reuses the
existing release instead of racing to create one. (electron-builder skips
uploading into a *published* release older than 2 hours with a warning; for a
late re-run of a completed tag, delete the old release and re-push the tag.)

macOS publishes exactly two DMGs — `Viby-macos-arm.dmg` (Apple Silicon) and
`Viby-macos-intel.dmg` (Intel) — with no zip or blockmap artifacts:
electron-updater on mac updates from zip, but that requires signing and is not
wired yet (see PLAN §2.1), so the update assets return with that feature.
macOS builds are unsigned, so users must right-click → Open on first launch.
Windows publishes `Viby-windows-x64.exe` and the `latest.yml` manifest —
Windows auto-update works unsigned once in-app updates are wired. Filenames
deliberately carry no version; the release tag is the version (see
[CIRULES.md](CIRULES.md) §3.13).

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

- No ads, paywalls, tracking, analytics or telemetry. Accounts, when they ship, will exist only for backup and sync — never to unlock playback.
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
