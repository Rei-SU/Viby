# Testing strategy

Run **what the change touches**, not everything. The full suite takes minutes and
plays audio; doing it after every small edit is wasteful and makes it harder to
tell which change broke what.

## The rules

1. **Default:** run the suites mapped to the files you changed (table below).
2. **Escalate to the full suite** when you change a shared contract:
   `src/shared/**`, `src/preload/**`, `src/renderer/lib/api.ts`, or the player
   state machine (`src/renderer/lib/player.svelte.ts`). Those affect everything.
3. **Before a release**, run everything, plus a hands-on pass.
4. **New feature → new scenario + a new row in this table.** A test that is not
   mapped will be forgotten.

## Running things

### One-time setup

The app runs yt-dlp on a vendored CPython, so neither development nor the
shipped build depends on a system Python:

```bash
node scripts/fetch-runtime.mjs          # host platform/arch
npm run runtime:mac                     # both mac architectures, for dist:mac
npm run runtime                         # host only, for dist:dir
```

The runtime lives in `resources/python/<os>-<arch>` and is copied into the app
by electron-builder. `resources/bin/yt-dlp.pyz` is vendored alongside it.

### Node suites (no app needed)

```bash
node tests/unit.mjs lyrics library     # targeted
node tests/unit.mjs                    # all
```

Each suite bundles itself with esbuild; `electron` is aliased to a stub for the
ones that touch main-process modules.

| Suite | Covers |
|---|---|
| `resolver` | yt-dlp runner, client selection, parsing, URL cache, no-direct-URL fallback |
| `innertube` | parsing of a captured response, search filters, browse |
| `catalog` | live catalog: filters, ranking, artist shelves, radio, audio-first |
| `thumbs` | thumbnail URLs across surfaces + CDN status |
| `artist-shelves` | prints an artist page's real shelf structure (diagnostic) |
| `library` | favourites/playlists CRUD, persistence, self-healing |
| `lyrics` | LRCLIB synced/plain, lyrics.ovh backup, cache, miss |
| `spotify` | Anonymous Spotify pathfinder: 200-track pagination, fields, non-playlist rejection |
| `import` | Link detection, all four non-Spotify adapters, matcher scoring, YouTube exact path |
| `downloads-store` | downloads index: references, shared-file survival, pruning, healing, orphan sweep, pinned lyrics, path safety |
| `downloads-manager` | yt-dlp progress parsing (known/unknown totals) and transient-vs-permanent failure classification |
| `download-groups` | Library download split: collection-owned vs loose songs, album order, offline artwork fallbacks |
| `library-items` | unified Library tiles: badges/full/partial marks, no downloaded-playlist duplicates, album coverage, orphan snapshots |
| `images` | saved-library artwork cache: content addressing, dedupe, bulk resolution, stats, clear |
| `network` | connectivity state machine with injected link/probe: offline, unreachable debounce, recovery, manual mode, dev override |
| `version` | SemVer ordering for update checks: prereleases, `v` prefix, build metadata, invalid tags |
| `updates` | update state machine with fake adapters: offline, macOS manual download, Windows download/install, overlapping checks, cancel, skipped versions, Ed25519 manifest verification, signed-hash hand-off |
| `release-notes` | release-notes lint: allowed sections, empty/missing/duplicate sections, internal jargon, CRLF |

### Manual update smoke test (Windows, real hardware)

The unit suite proves the state machine; only this proves NSIS can replace a
running per-user install on a real machine.

1. Install the current release (`Viby-windows-x64.exe`) and launch it.
2. Open Settings → Updates → **Check for updates**. With no newer release it
   must say "You're up to date".
3. Bump `package.json`, tag and push a newer `v*` release; wait for it to go
   live.
4. In the installed build: check → **Download**. The progress bar must advance
   and reach 100%, then **Restart & install**.
5. Confirm Viby quits, NSIS installs silently, and Viby reopens on the new
   version (`Settings → Updates` shows the new current version).
6. Open `%APPDATA%\Viby\logs\updater.log`; it must contain the check, download
   and install entries with no verification errors.
7. Cancel path: start a download, click **Cancel**, then download again. The
   first attempt must stop and the second must complete.
8. Integrity path: publish a build whose `update-manifest.json` does not match
   its installer (or temporarily edit the manifest asset); the download must be
   deleted and the state must show the verification failure, never install.

Verified on Windows 11 (2026-10-24): the NSIS installer replaced the running
per-user install and relaunched successfully. Re-run this on Windows 10 and
after any updater change.

### E2E scenarios (app must be running)

```bash
# macOS/Linux, in one terminal:
VIBY_DEBUG_PORT=9222 npm run dev
```

```powershell
# Windows PowerShell, in one terminal:
$env:VIBY_DEBUG_PORT='9222'; npm run dev
```

```bash
node tests/e2e/run.mjs lyrics         # targeted
node tests/e2e/run.mjs                # all scenarios
```

Scenarios are independent; each sets up its own state and cleans up. They play
**silently** (volume 0, muted) and restore your settings when finished. Don't use
the app while they run — they own the queue.

| Scenario | Covers |
|---|---|
| `images` | Home artwork actually renders, home carousels stay inside the docked page, no broken images |
| `playback` | start, seek a cached file, auto-advance, dock sync, quality tag |
| `reconnect` | a dead source on resume shows the spinner and re-resolves |
| `autoplay` | radio extension when the queue ends |
| `links` | player-bar title → song page, artist link, related list |
| `lyrics` | panel opens docked beside the page, page width shrinks and restores, synced active line, click-to-seek, closes |
| `lyrics-change` | a new track's lyrics reset to the top (no inherited scroll) |
| `library` | playlist create/list/open/delete |
| `resume` | session save → reload → restored paused at the timestamp |
| `navigation` | drag strip, full-bleed artist banner, titlebar back/forward, artist page from search, history restore |
| `quick-search` | centered titlebar field, recents, grouped songs/artists/playlists, show-more filters, Enter routing, song click, arrow navigation |
| `settings` | sidebar entry, quality/autoplay/cache-cap persist, clear control |
| `offline` | manual offline: local-first Home, titlebar pill, gated Import, Charts page stays gone, Library stays and opens, separate Downloads page is gone, auto restores |
| `import` | paste a Spotify link, match 50 tracks, create and clean up a playlist |

### Behaviour suite (separate)

```bash
node tests/behaviour.mjs
```

Queue editing, repeat modes, shuffle, favourites, history, media session. It owns
the queue for its duration and restores settings afterwards.

## Impact map

Find the row for what you changed; run what it lists.

| You changed | Run |
|---|---|
| `src/main/ytdlp/**` | unit `resolver` (incl. the data-saver ceiling) · e2e `playback` |
| `src/main/innertube/**` | unit `innertube`, `catalog`, `thumbs` · e2e `images`, `navigation` |
| `src/main/lyrics.ts` | unit `lyrics` · e2e `lyrics` |
| `src/main/import/**` | unit `import`, `spotify` · e2e `import` |
| `src/renderer/components/ImportView.svelte` | e2e `import` |
| `src/main/library.ts` | unit `library` · e2e `library` · behaviour |
| `src/main/session.ts` | e2e `resume` |
| `src/main/cache/**`, `src/main/media.ts`, `viby-media://` handler | e2e `playback`, `resume` |
| `src/main/settings.ts`, `src/renderer/components/SettingsView.svelte` | e2e `settings`, `playback` (volume restore) · behaviour |
| `src/main/updater*.ts`, `release-feed.ts`, `update-manifest.ts`, `src/renderer/lib/updates.svelte.ts` | unit `version`, `updates` · manual update smoke test (Windows) |
| `.github/workflows/release.yml`, `scripts/check-release-notes.mjs` | unit `release-notes` · inspect the draft release body on the next tag |
| `src/main/json-store.ts` | unit `library` · e2e `library`, `resume` |
| `src/main/downloads/**`, `src/main/network.ts` | unit `downloads-store`, `downloads-manager`, `network` · e2e `offline`, `playback` |
| `src/renderer/lib/downloads.svelte.ts`, `src/renderer/lib/network.svelte.ts`, `OfflineHome` | e2e `offline`, `playback`, `navigation` · unit `download-groups` |
| `src/renderer/lib/library-items.ts`, `LibraryView`, `DownloadBadge` | unit `library-items` · e2e `offline`, `library` |
| `src/renderer/lib/artwork.svelte.ts`, `src/main/cache/images.ts` | unit `images` · e2e `offline`, `images` |
| `src/main/ipc.ts` | depends on the handler; if the request/response shape changed → **everything** |
| `src/renderer/lib/player.svelte.ts` | e2e `playback`, `reconnect`, `autoplay`, `resume`, `links` · behaviour |
| `src/renderer/lib/nav.svelte.ts` | e2e `navigation`, `links` |
| `src/renderer/components/SearchBar.svelte`, `src/renderer/components/SearchView.svelte`, `src/renderer/lib/search.svelte.ts` | e2e `quick-search`, `navigation`, `links` |
| `src/renderer/lib/lyrics.svelte.ts`, `LyricsPanel.svelte` | e2e `lyrics`, `lyrics-change` |
| `src/renderer/lib/playlists.svelte.ts`, `LibraryView`, `CollectionView`, `PlaylistPicker` | e2e `library` · behaviour |
| `src/renderer/lib/artist.ts` | e2e `links`, `navigation` |
| `src/renderer/components/TrackRow.svelte` | e2e `links`, `navigation`, `lyrics` · visual check |
| `src/renderer/components/PlayerBar.svelte` | e2e `playback`, `links`, `lyrics` |
| `src/renderer/components/DetailView.svelte`, `MediaCard`, `HomeView` | e2e `navigation`, `images` |
| `src/renderer/components/TrackView.svelte` | e2e `links` |
| `src/renderer/components/Icon.svelte`, `Cover.svelte` | e2e `images` · visual check |
| `src/renderer/App.svelte` | all e2e (layout, routes, panels) |
| `src/renderer/styles/global.css` | visual check · e2e `images` as a sanity pass |
| `src/shared/**`, `src/preload/**`, `src/renderer/lib/api.ts` | **everything** (contract) |
| `electron.vite.config.ts`, `package.json`, `electron-builder.yml` | build + launch smoke test; e2e `images` |
| `scripts/fetch-runtime.mjs`, `src/main/ytdlp/binary.ts` | unit `resolver` (asserts the vendored runtime) · packaged smoke test (below) |
| `scripts/make-icons.py`, `resources/icon.*`, `src/main/menu.ts` | `npm run icons` · `npm run dist:dir` · check `CFBundleIconFile` and the packaged menu name |

## Windows notes

- **Local packaging** needs Developer Mode enabled (Settings → Privacy & security →
  For developers → Developer Mode), otherwise electron-builder cannot extract the
  `winCodeSign` archive (it contains macOS symlinks). CI runners already have it on.
- **Environment variables** in PowerShell use `$env:NAME='value'`, not the POSIX
  `NAME=value` form. Example: `$env:VIBY_DEBUG_PORT='9222'; npm run dev`.
- **`npm run icons`** and **`npm run measure`** are macOS-only (iconutil / `ps`).
- The unit runner (`tests/unit.mjs`) now resolves esbuild via Node and writes
  bundles to the OS temp dir, so it runs on Windows too.

## What the suites cannot check

- **The OS media keys / Now Playing panel** — needs a human.
- **Window drag/resize** — needs a human (the drag strip's computed style is
  asserted, but not that the window moves).
- **Memory/CPU budget** — `npm run measure` against the packaged app (run `npm run dist:dir` first). It samples RSS/CPU per process across idle, playback, lyrics and a 2-minute soak.
- **Packaging** — run `npm run dist:dir`, launch the app in `dist/mac/`, play a
  track, and confirm `ps` shows `Viby.app/Contents/Resources/python/bin/python3`
  running `yt-dlp-src/__main__.py`. That is the "no system Python" proof.
- **Audio actually audible** — tests mute; a human must listen.
- **In-place Windows updates** — the state machine is unit-tested with fakes;
  NSIS replacing a running install needs the manual smoke test above.
