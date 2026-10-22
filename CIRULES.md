# CIRULES — Commit, Integration & Release Rules

This file is the contract for how work enters this repository: how commits are
written, how versions are chosen, how releases are cut, and what CI is allowed
to do. It exists because a commit history is a permanent, public artifact. A
stranger deciding whether this project is serious reads the log before the
README, and history that looks like "fighting yourself in public" — five
consecutive `fix` commits for one feature, tags moved by hand, versions picked
by mood — costs more trust than the bugs did.

Normative words: **MUST** = blocking, **SHOULD** = deviation needs a reason in
the PR, **MAY** = optional.

---

## 0. Principles

1. **History is an interface.** Commits are read by reviewers, by `git blame`,
   by `git bisect`, and by whoever debugs this in a year.
2. **`main` is always releasable.** A broken `main` is an incident, not a
   Tuesday.
3. **One change, one commit, one reason.** If the subject needs "and", split it.
4. **A version number is a promise to people who already installed the app.**
5. **Automate the repeatable, document the judgement.** Anything with a
   deterministic answer belongs in a script or workflow; anything else belongs
   in this file.

---

## 1. Commits

### 1.1 What a commit is for

A commit is the unit of: review, revert, `git bisect`, blame attribution, and
release notes. It is *not* a save point. Work-in-progress belongs in
`git stash` or a throwaway branch.

### 1.2 Anatomy

```
<type>(<scope>): <subject>

<body — why this change exists, what it replaces, what it costs>

<footer — refs, breaking changes, co-authors>
```

- **Subject**: imperative mood ("add", not "added"/"adds"), ≤ 72 characters
  total, no trailing period, no issue number (that goes in the footer).
- **Body**: separated by one blank line, wrapped at 72 columns. Explain *why*;
  the diff already shows *what*. Name the alternative you rejected when the
  choice was not obvious.
- **Footer**: `Refs #12`, `Closes #12`, `BREAKING CHANGE: <what broke>`,
  `Co-authored-by: Name <email>`.

### 1.3 Types

| Type | Use for | Version impact |
| --- | --- | --- |
| `feat` | new user-visible capability | MINOR |
| `fix` | corrected behaviour | PATCH |
| `perf` | same behaviour, measurably faster | PATCH |
| `refactor` | no behaviour change | none |
| `docs` | documentation only | none |
| `test` | tests only | none |
| `build` | packaging, dependencies, toolchain | none |
| `ci` | workflows and release automation | none |
| `chore` | housekeeping, version bumps | none |
| `revert` | reverts a previous commit | mirrors the reverted commit |

Types are load-bearing: `feat`/`fix` are what release notes are built from, and
`refactor` tells a reviewer "nothing should change here", so they read it
differently.

### 1.4 Scopes for this repository

`main`, `renderer`, `preload`, `ipc`, `player`, `library`, `downloads`,
`runtime`, `release`, `deps`, `tests`, `docs`.

Use the narrowest true scope. `fix(player): resume after track end` beats
`fix: stuff`. Omit the scope only when no single area applies, e.g.
`chore(release): 0.2.0` may keep its scope because it names the activity.

### 1.5 Atomicity tests

A commit is correct only when **all** of these hold:

- **It builds and typechecks on its own.** No commit leaves `main` red.
- **It reverts alone** without dragging unrelated code with it.
- **It survives `git bisect`** as a meaningful yes/no answer.
- **It is reviewable in one sitting.** Over ~400 changed lines, split —
  unless the diff is mechanical (rename, format, dependency bump), which the
  body MUST say.
- **The subject fully describes it.** No reader should need the diff to know
  what changed.

Refactoring and behaviour changes MUST NOT share a commit. Land the refactor
first so the fix diff is small enough to actually review.

### 1.6 What the body must contain

Write for the person who finds this commit via `git blame` during an incident:

- the problem and its user-visible symptom;
- why this approach over the obvious alternative;
- what it deliberately does **not** fix (follow-up work);
- for risky changes: how it was verified, and how to roll it back.

Do not narrate the diff ("changed X to Y"). Do not write "as discussed" — link
the issue. Decisions that are expensive to reverse (data formats, IPC
contracts, runtime layout) MUST be recorded in [`PLAN.md`](PLAN.md) or a short
ADR, not only in a commit message.

### 1.7 Prohibited

- `wip`, `save`, `backup`, `tmp`, `more fixes`, `.`, `asdf`.
- Fixing your own previous commit in a new commit ("fix the fix", "oops").
  Use `--amend` (unpushed) or `rebase -i` (pushed, unreleased).
- Generated output: `dist/`, `out/`, `node_modules/`, `resources/python/`.
- Secrets, tokens, `.env` files, absolute machine paths, personal data.
- Merge noise from `git pull`. Configure once:
  ```bash
  git config --global pull.rebase true
  ```
- Mixing a formatter/rename sweep with logic changes.

### 1.8 Fixing a bad commit

| Situation | Do this |
| --- | --- |
| Wrong message, not pushed | `git commit --amend` |
| Forgot a file, not pushed | `git add … && git commit --amend --no-edit` |
| Three messy commits, not pushed | `git rebase -i HEAD~3` → `fixup` |
| Pushed, no release yet | `git rebase -i`, then `git push --force-with-lease` |
| Already released | **Do not rewrite. Fix forward.** |

Two collaborators pulling a rewritten branch is a bad afternoon. A single
maintainer rewriting unpushed history is just editing a draft. Once a release
is public, the commits behind it are immutable for the same reason the tag is
(§3.6).

### 1.9 Reverts

A revert is a normal commit, not a history edit:

```
revert: "feat(library): fold downloads into library"

This reverts commit 2059183.

The merged view lost the distinction between local and streamed tracks in
search results (#31). Re-landing after the resolver exposes provenance.
```

Revert first, diagnose second. A red `main` is worse than a reverted feature.

### 1.10 Signing (SHOULD, once there is more than one maintainer)

Sign commits and tags with an SSH or GPG key, and enable "Require signed
commits" on `main` when the team grows. Unsigned history is acceptable for a
single-maintainer project; it is not acceptable for a project accepting
patches from strangers.

### 1.11 Worked example from this repository

The v0.1.0 release work landed as five commits:

```
5bcc13e Add GitHub Actions release automation for macOS and Windows
202a1cb Fix Windows runtime fetch: stripped install_only tar.gz
dd0e6ec Trim macOS release to the two DMG installers
4db3d04 Drop macOS update artifacts from releases
4461607 Fix release publish step: gh needs an explicit repo
```

Read by a stranger, this says "the author discovered the design while
shipping." The honest summary is two commits:

```
ci: add tag-driven macOS and Windows release pipeline
fix(ci): publish the draft and upload the stripped Windows runtime
```

The end state is identical; the story is not. The lesson is not "never
iterate" — iterate locally, publish the conclusion. Also avoid:

```
98ded44 Merge branch 'main' of https://github.com/Rei-SU/Viby   # pull noise
bc43b64 readme                                                   # says nothing
3045c81 Backbones-state                                          # says nothing
```

A subject MUST be understandable with zero context, six months later.

---

## 2. Branches, pull requests, review

### 2.1 Trunk-based development

- `main` is the only long-lived branch and MUST always build, typecheck and
  pass the relevant suites.
- Branches are short-lived (hours to a few days): `feat/<slug>`,
  `fix/<slug>`, `chore/<slug>`. Delete after merge.
- `release/<version>` branches MAY exist only for a hotfix (§3.11); they are
  deleted once the patch ships.
- No long-running develop branch, no git-flow.

### 2.2 Pull request standard

- **Title** follows the commit convention; it becomes the squash commit.
- **Description** states: problem, approach, what was tested, screenshots for
  UI changes, and anything deliberately out of scope.
- One logical change per PR. A PR that needs a summary with three "also"s is
  three PRs.

### 2.3 Merge strategy

- **Squash merge** for multi-commit branches: the PR title becomes one honest
  commit on `main`. This is the default.
- **Rebase merge** is acceptable when every commit in the branch is already
  atomic and worth keeping (e.g. a refactor series).
- **Merge commits** are prohibited on `main`; they add a node with no
  information and break linear `git log --oneline` reading.

### 2.4 Review

- Reviewers approve the *behaviour and the reasoning*, not just the syntax.
- Anything touching `src/shared/**`, `src/preload/**`, the IPC surface or the
  player state machine needs a second pair of eyes and the full test suite
  (see [`TESTING.md`](TESTING.md)).
- Review within one business day; a stalled PR is a stalled project.
- Never force-push a branch someone else is reviewing without saying so.

### 2.5 Branch protection (when Collaborators are added)

Require on `main`: pull request, green checks, linear history, no force push,
no deletion. Dismiss stale approvals on new commits. These settings are part of
the project's rules, not personal preference.

### 2.6 Never disable a check to go green

A failing check is information. Fix the code, fix the test, or revert. Do not
add `continue-on-error`, `|| true`, `--passWithNoTests`, or a skip marker to
make CI quiet; if a test is genuinely invalid, delete it in its own commit with
a reason.

---

## 3. Versioning

Semantic Versioning: `MAJOR.MINOR.PATCH`.
<https://semver.org>

- **MAJOR** — installed users must act (data migration, removed feature,
  incompatible settings).
- **MINOR** — new capability, backwards compatible.
- **PATCH** — bug fixes only.

### 3.1 Precedence

Versions are ordered numerically, left to right, and a version is never reused.
`1.10.0` > `1.9.4`. Pre-release suffixes order before the release:
`1.0.0-beta.1 < 1.0.0-beta.2 < 1.0.0-rc.1 < 1.0.0`.

### 3.2 Single source of truth

`package.json` is authoritative. The tag MUST be `v` + that exact version;
[`.github/workflows/release.yml`](.github/workflows/release.yml) fails on
purpose before building if they disagree.

```bash
node -p "require('./package.json').version"   # 0.1.0
git tag -l --points-at HEAD                   # v0.1.0
```

`package-lock.json` MUST be committed in the same commit as the version bump.

### 3.3 While the app is 0.x

Pre-1.0, SemVer permits anything to break — which is exactly why 0.x needs its
own discipline instead of "whatever":

| Change | Version |
| --- | --- |
| New user-visible feature | `0.MINOR.0` |
| Breaking change (§3.4) | `0.MINOR.0` |
| Fix with no new surface | `0.x.PATCH` |
| Docs / CI / refactor / dependency bump only | **no release** |

The last row matters: not every merge is a release. Shipping a version because
a workflow was fixed trains users to ignore version numbers.

`1.0.0` is earned, not scheduled: playback, library and downloads are stable,
and the settings + data formats are frozen enough to promise compatibility.

### 3.4 What counts as breaking for this app

APIs are only part of it. Any of these is a breaking change:

- the settings/store schema or its keys;
- the on-disk library or download-manifest format;
- IPC channel names or payload shapes between main and renderer;
- the vendored runtime layout under `resources/python/` (paths, names);
- the minimum supported macOS/Windows version;
- the update contract (`latest.yml`) for already-installed clients.

Renaming an IPC channel is `BREAKING CHANGE:` even though no user sees it —
they see a blank window.

### 3.5 Choosing the number

```
Does an installed user have to act?        → MAJOR (MINOR while 0.x)
Can a user point at something new?         → MINOR
Did something broken start working?        → PATCH
Did only the repo change (docs/CI/refactor)? → no release
```

Tie between MINOR and PATCH → choose MINOR. Undercounting a feature is worse
than overcounting a fix: users forgive a small number, not a surprise.

### 3.6 Tags

- **Annotated** tags only: `git tag -a v0.2.0 -m "Viby 0.2.0"`.
- A tag MUST point at a commit that was actually tested and is on `main`.
- **Never** tag a detached, unmerged commit, and never tag "to trigger a
  build" — that is what local builds are for.
- **Published tags are immutable.** Anyone who downloaded `v0.1.0` must be
  able to reproduce exactly that binary from the tag. If a release is broken,
  ship `v0.1.1` and say why.
- While a release is still a **draft** and nothing was announced, moving the
  tag is permitted — but treat it as an incident, not a workflow. The v0.1.0
  tag was moved four times during bring-up; that exception is now closed.
- **Never delete and recreate a published release to "reuse" a version.** A
  version is spent.

### 3.7 Pre-releases

Any `v*` tag currently publishes as a normal release. Until the workflow marks
`-beta.N` / `-rc.N` as GitHub pre-releases, do **not** push them: the suffix
would be cosmetic and `latest.yml` would offer the beta to every installed
client. Bump `prerelease: true` in the publish step before using them.

### 3.8 Support window

- **0.x**: only the latest release is supported. Fixes go into the next patch.
- **1.0+**: the latest minor and the previous minor receive patch releases.
  Older versions get a "please upgrade" note, not a backport.

State this in the release notes the first time it matters.

### 3.9 Deprecation

Announce in release notes one minor ahead ("X will be removed in 0.5.0"), keep
it working through that minor, then remove it with a `BREAKING CHANGE:` footer.
Silent removals are forbidden: a removed feature without a note reads as a bug.

### 3.10 Broken releases: fix forward

1. Reproduce from the published artifact, not the dev build.
2. Fix on `main`, bump PATCH, tag, publish.
3. In the release notes, say what was wrong in the previous version and who is
   affected.

Do not unpublish, do not silently swap assets. A visible mistake with a clear
fix is credible; a rewritten past is not.

### 3.11 Hotfixes

When `main` has moved on and an installed version is broken:

```bash
git switch -c fix/0.1.1 v0.1.0        # branch from the broken release
# minimal fix only — no refactors
npm version 0.1.1 --no-git-tag-version
git commit -am "fix(player): ..."
git tag -a v0.1.1 -m "Viby 0.1.1"
git push origin fix/0.1.1 v0.1.1
```

Cherry-pick the fix back to `main` immediately, or the next release
reintroduces the bug.

### 3.12 Build metadata

`0.2.0+build.37` MUST NOT be released; GitHub releases, `latest.yml` and
`electron-updater` all compare SemVer, and build metadata is ignored in
precedence. Build identity comes from the git SHA, which the workflow already
has.

### 3.13 Artifact names

Filenames are user-facing text. They answer "which file do I need?" — not
"which build is this?". The version lives in the tag, the release title and
`package.json`; repeating it in the filename adds noise, ages badly in links,
and tells the user nothing they can act on.

| Platform | File |
| --- | --- |
| macOS, Apple Silicon | `Viby-macos-arm.dmg` |
| macOS, Intel | `Viby-macos-intel.dmg` |
| Windows, x64 | `Viby-windows-x64.exe` |

Rules:

- Pattern: `Viby-<platform>-<arch>.<ext>`. Platform and architecture in words
  a user recognizes: `macos` / `windows`, and `arm` / `intel` on macOS
  (`arm64` and `x64` are engineering terms — a Mac user knows whether they
  bought an Intel or an Apple Silicon machine). Windows keeps `x64` because
  that is what Windows itself calls it.
- Lowercase, hyphen-separated, ASCII. No spaces, underscores, `setup`,
  `installer`, `final`, `latest`, or dates.
- **No version in the name.** The tag is the version; a file called
  `0.1.0` is wrong the moment it is copied out of its release.
- Two consequences, accepted deliberately: separate releases contain
  identically named files, so a downloaded file alone does not reveal its
  version (the in-app About screen does), and repeat downloads may become
  `Viby-macos-arm (1).dmg` in the browser. Both are cheaper than making users
  decode `arm64` / `x64`.
- Machine files keep their conventional names and are never renamed:
  `latest.yml`, `*.blockmap`. They are read by `electron-updater`, not humans.
- Names MUST be unique within a release. Adding a platform or architecture
  means adding its name here first.
- Renaming a published asset breaks every external link that pointed at it;
  treat it as a user-visible change and say so in the release notes.

Implementation: `win.artifactName` covers Windows directly
(`${productName}-windows-${arch}.${ext}`). electron-builder cannot map
`arm64` → `arm` or `x64` → `intel` in a template, so the macOS job renames the
two DMGs before uploading them (`.github/workflows/release.yml`).

---

## 4. Releases

### 4.1 Cadence

Release when there is something to say, not on a calendar. Never release to
"clear the queue": a version with no user-visible change teaches users that
updates are noise.

### 4.2 Cutting a release

```bash
# 1. the bump is its own commit, nothing else in it
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): 0.2.0"

# 2. write the notes, tag the tested commit, push main and the tag together
$EDITOR /tmp/viby-0.2.0-notes.md
git tag -a v0.2.0 -F /tmp/viby-0.2.0-notes.md
git push origin main v0.2.0
```

Before tagging:

- [ ] `npm run typecheck` passes;
- [ ] suites for everything touched pass (`TESTING.md`); full suite for
      shared contracts;
- [ ] a hands-on pass of the changed flows;
- [ ] `package.json` version matches the intended tag exactly;
- [ ] no `wip`/`tmp` commits in the range: `git log --oneline vLAST..HEAD`;
- [ ] the annotated tag message carries the release notes and reads well
      (see §4.3).

### 4.3 Release notes are the changelog

The release notes are the **annotated tag message**. They are written once,
travel with the exact commit they describe, and become the GitHub release body
verbatim; there is no separate changelog file to keep in sync. `prepare-release`
refuses a tag without a grouped section, so a release cannot ship blank.

One line per user-visible change, in user language, grouped as
**Added / Changed / Fixed / Removed / Security**. No commit hashes, no
"miscellaneous improvements". If a release has nothing to list, it was not a
release.

```
### Fixed
- Downloads no longer restart from zero after a network drop (#44)

### Changed
- Library search now includes offline albums
```

### 4.4 Pipeline invariants

These are not preferences; the workflow depends on them:

- Tag `v*` is the only trigger. Every asset is produced by the workflow: no
  hand uploads, no hand-renamed files in a release.
- `prepare-release` verifies `tag == package.json`, extracts the annotated tag
  message as the release notes, then creates or reuses a **draft** and clears
  stale assets.
- Platform jobs upload into that draft; the release is published only after
  **all** platforms succeed, so a half-built release is never public.
- macOS ships exactly two DMGs — `Viby-macos-arm.dmg` (Apple Silicon) and
  `Viby-macos-intel.dmg` — and no update artifacts until signing exists.
  Windows ships `Viby-windows-x64.exe`, its `.blockmap` and `latest.yml`
  (§3.13).
- The publish job checks out the repository to sign the update manifest; `gh`
  calls still pass `-R "$GITHUB_REPOSITORY"` so they cannot act on the wrong
  repository.
- Re-running a failed platform job is safe and reuses the draft. Re-running is
  always preferred to deleting the release.
- electron-builder refuses to upload into a *published* release older than two
  hours; for a late re-run, cut a new patch instead of moving the tag.

### 4.5 Channels

Today there is one channel: stable. A beta channel, if added, MUST be a
separate workflow writing to GitHub pre-releases and a distinct manifest —
never the same `latest.yml` that stable clients poll.

### 4.6 Signing status (known limitation)

macOS builds are unsigned (`identity: null`). Users must right-click → Open on
first launch, and macOS auto-update stays disabled until a Developer ID
certificate and notarization are in place. Windows auto-update works unsigned.
This is documented in [`PLAN.md`](PLAN.md) §2.1; it MUST be mentioned in the
release notes of every macOS release while it remains true.

---

## 5. Data and compatibility

The app is local-first: the user's library, downloads and settings are the
product. Treat them as a public API.

- Every persisted format (settings, library, download manifest) carries a
  schema version.
- Migrations are **forward-only** and tested against a fixture of the previous
  format.
- Before migrating, copy the existing file; if migration fails, restore the
  copy and surface an error instead of starting empty. Silent data loss is a
  P0.
- Removing a migration is allowed only after the support window in §3.8 has
  passed for the version that wrote it.
- A change to a persisted format is MINOR while 0.x, MAJOR after 1.0 (§3.4).

---

## 6. CI rules

### 6.1 `main` is always green

- Every push and PR to `main` SHOULD run typecheck and the relevant suites.
- A red `main` blocks all merges except the fix for that redness.
- The release workflow builds but does **not** test. Tests are not optional
  because they are not automated: run them locally per `TESTING.md` and say in
  the release PR what was run.

### 6.2 Workflow hygiene

- **Least privilege.** Default to `permissions: contents: read`; elevate only
  the job that needs it (`contents: write` for release uploads).
- **Pin actions to a commit SHA**, not a moving tag:
  ```yaml
  - uses: actions/checkout@<commit-sha> # v4.2.2
  ```
  Get the SHA with `gh api repos/actions/checkout/commits/v4 --jq .sha`.
  Dependabot may bump them; that is a reviewed change.
- **Pin runner images where the behaviour matters.** `macos-15` is pinned on
  purpose; `ubuntu-latest` migrated to Ubuntu 26 in Oct 2026 without any repo
  change.
- **Concurrency.** Cancel superseded PR runs (`cancel-in-progress: true`);
  never cancel a release (`false`, as today).
- **Timeouts.** Every job gets `timeout-minutes`; a hung job holds a runner
  and hides the failure.
- **Cache keys** derive from lockfiles (`hashFiles('package-lock.json')`), not
  from the branch name.
- **Never** use `pull_request_target` with a checkout of the PR head; that is
  how fork PRs get your token. Use `pull_request` for untrusted code.
- **Secrets** come from `secrets.*`, are never echoed, and are absent from
  fork PR runs by design. The release path uses the built-in `GITHUB_TOKEN`;
  update signing, when enabled, adds `VIBY_UPDATE_KEY` (see CONTRIBUTING.md).
- Workflow files are production code: they get the same review, and a change
  to publishing MUST be tested on a throwaway tag before the real release.

### 6.3 What CI must never do

- Publish or deploy from a PR build; only tag pushes publish.
- Run with a write token against fork code.
- Hide failure: no `|| true`, no `continue-on-error` on build/test steps, no
  silent retries.
- Print environment dumps "for debugging" — that is how tokens leak into
  public logs.
- Build a different thing than a developer builds: `npm ci` (locked), the same
  Node major (22.12+), the same runtime fetch script.

### 6.4 Flaky tests

A flaky test is a bug in the test. Quarantine it within 24 hours with a linked
issue and an owner, remove it from the gating set, and delete or fix it within
a week. Never paper over it with retries that are not reported.

### 6.5 Supply chain

- `package-lock.json` is committed; CI installs with `npm ci`.
- The vendored CPython and `yt-dlp.pyz` are pinned by version (and checksum
  where `scripts/fetch-runtime.mjs` supports it); they are fetched at package
  time, never at runtime on the user's machine.
- Dependency updates are their own PRs (`build(deps): …`), never mixed with
  feature work, so a regression is attributable.
- `npm audit` findings are triaged, not ignored: fix, pin, or document why the
  advisory does not apply.

---

## 7. Known gaps

Honest list of where this repository does not yet meet its own rules. Fixing
these is ordinary work, not an emergency.

| Gap | Impact | Fix |
| --- | --- | --- |
| No PR CI workflow (only `release.yml`) | typecheck/tests can regress on `main` | add `ci.yml`: `npm ci`, `npm run typecheck`, targeted suites |
| Actions pinned to `@v4`, not SHAs | supply-chain drift | pin SHAs, let Dependabot bump |
| No `commitlint` hook | malformed subjects reach `main` | §8 |
| macOS unsigned | Gatekeeper friction, no auto-update | Developer ID + notarization (PLAN §2.1) |
| Pre-releases publish as stable | a beta reaches every client | `--prerelease` support before using suffixes |

---

## 8. Enforcement and exceptions

- Adopt `commitlint` + `husky` when the history drifts again (it is a hook,
  not a law: it rejects malformed subjects, not dishonest ones):
  ```bash
  npm i -D @commitlint/cli @commitlint/config-conventional husky
  echo 'export default { extends: ["@commitlint/config-conventional"] };' > commitlint.config.mjs
  npx husky init
  echo 'npx --no -- commitlint --edit "$1"' > .husky/commit-msg
  ```
- An exception to any MUST in this file is allowed only when the PR or commit
  body states the reason and files a follow-up. "It was faster" is not a
  reason; "the old format must keep loading until 1.0" is.
- This file is reviewed like code. Changing a rule is a `docs:` PR with the
  rationale, not a quiet edit.

---

## 9. Quick reference

```
<type>(<scope>): <imperative subject, ≤72>

why it exists; what it replaces; what it does not fix
```

```bash
git commit --amend                      # wrong message, not pushed
git rebase -i HEAD~3                    # squash before pushing
git push --force-with-lease             # only your own branch
git log --oneline v0.1.0..HEAD          # what will ship
node -p "require('./package.json').version"
```

| You changed… | Ship |
| --- | --- |
| only docs / CI / deps / refactor | nothing |
| a bug | `0.x.PATCH` |
| a feature | `0.MINOR.0` |
| a persisted format or IPC contract | `0.MINOR.0` (`MAJOR` after 1.0) |
| nothing user-visible, but the release is broken | `0.x.PATCH` |

**Release assets:** `Viby-macos-arm.dmg`, `Viby-macos-intel.dmg`,
`Viby-windows-x64.exe` (plus `latest.yml` and `.blockmap`, Windows only). No
version in any filename — the tag is the version (§3.13).

**Release in four lines:**

```bash
npm run typecheck && node tests/unit.mjs
npm version 0.2.0 --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): 0.2.0"
git tag -a v0.2.0 -m "Viby 0.2.0" && git push origin main v0.2.0
```
