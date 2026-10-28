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
2. Run the relevant tests.
3. Write the release notes in a temporary file (see below) and tag the tested
   commit:

   ```bash
   node scripts/check-release-notes.mjs /tmp/viby-X.Y.Z-notes.md
   git tag -a vX.Y.Z --cleanup=verbatim -F /tmp/viby-X.Y.Z-notes.md
   git push origin main vX.Y.Z
   ```

The notes are for people using Viby: what they can do now, what changed, or
what stopped going wrong. Do not mention internal components, hashes, build
steps or logs; keep it to what a user would notice. The workflow runs
`scripts/check-release-notes.mjs` before creating the draft and rejects
missing, empty or unknown sections and internal jargon.

macOS builds are ad-hoc signed but not notarized, so the notes must tell Apple
Silicon users the one command that works:
`xattr -dr com.apple.quarantine /Applications/Viby.app`. Do not point them at
Privacy & Security → Open Anyway. A quarantined build whose signature cannot be
validated is reported as "damaged", and that dialog has no Open Anyway button;
it is a Gatekeeper decision, not a corrupt download.

`--cleanup=verbatim` matters: without it, git strips lines starting with `#`,
including every `### Added` heading. The annotated tag message becomes the
release body, with a compare link to the previous tag appended by the workflow.
There is no separate changelog file to keep in sync: the same message is baked
into the build by `scripts/build-changelog.mjs`, which is what the in-app
What's New sheet shows. The build jobs fetch the full tag history explicitly
and set `VIBY_REQUIRE_CHANGELOG=1`, so a build whose running version has no
notes fails instead of shipping a release with an empty sheet.

The build jobs use the repository's built-in `GITHUB_TOKEN`. Publishing also
requires the update-signing secret below: once a public key is pinned, the
publish job refuses to go live without it. If publishing fails with 403, set
Actions → General → Workflow permissions to "Read and write".

### Signed updates

The app verifies an Ed25519 signature over the installer hashes, so a
compromised GitHub account cannot publish a malicious update. A keypair is
already generated for this repository; its public half is pinned in
`src/main/update-key.ts`. The private key must be stored as the repository
secret `VIBY_UPDATE_KEY` (Settings → Secrets and variables → Actions). The
`publish-release` job signs `update-manifest.json` with it and uploads the
manifest after the installers.

For a fork or a deliberate rotation, generate a new keypair:

```bash
node scripts/update-manifest.mjs generate --force
```

That writes the public key into `src/main/update-key.ts` (commit it) and the
private key to `~/.config/viby/update-key.pem` (never commit it). Add the
private key's contents as `VIBY_UPDATE_KEY` **before** tagging a release from a
commit that contains the public key. Once a build pins a key it fails closed —
a release with no manifest, a bad signature, or a hash mismatch is refused.
Rotating the key strands installed builds, so don't do it casually.

There is no unsigned fallback for a build that pins a key; the GitHub asset
digest over TLS only applies to builds compiled without one.

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
electron-updater on mac updates from zip, but that requires signing, so those
assets return with Developer ID signing (see PLAN §2.1).
macOS builds are unsigned, so the first launch must be approved in System
Settings → Privacy & Security → Open Anyway (recent macOS removed the
right-click bypass). Windows publishes `Viby-windows-x64.exe` and the
`latest.yml` manifest — Windows auto-update works unsigned and is wired:
installed builds check GitHub, download and install in place. On macOS the same
check downloads the matching DMG and opens it, since an ad-hoc-signed build
cannot replace itself. The release also carries a small signed
`update-manifest.json`; it is published after the installers are uploaded and
before the release goes live. The publish job refuses to finish if
`VIBY_UPDATE_KEY` is missing. Filenames deliberately carry no
version; the release tag is the version (see [CIRULES.md](CIRULES.md) §3.13).

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
