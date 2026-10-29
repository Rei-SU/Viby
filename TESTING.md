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
| `innertube` | parsing of a captured response, search filters, browse, YouTube's release labels |
| `catalog` | live catalog: filters, ranking, artist shelves, radio, audio-first |
| `thumbs` | thumbnail URLs across surfaces + CDN status |
| `artist-shelves` | prints an artist page's real shelf structure (diagnostic) |
| `library` | favourites, saved releases and playlists CRUD, persistence, self-healing |
| `lyrics` | LRCLIB synced/plain, lyrics.ovh backup, cache, miss |
| `spotify` | Anonymous Spotify pathfinder: 200-track pagination, fields, non-playlist rejection |
| `import` | Link detection, all four non-Spotify adapters, matcher scoring, YouTube exact path |
| `downloads-store` | downloads index: references, shared-file survival, pruning, source-aware collection cancellation, healing, orphan sweep, pinned lyrics, path safety |
| `downloads-manager` | yt-dlp progress parsing (known/unknown totals), transient-vs-permanent failure classification, audio-first download id choice, user pause/resume and restart persistence |
| `download-jobs` | downloads panel grouping: collection coverage, shared jobs, loose songs, live progress and state ordering |
| `download-groups` | Library download split: collection-owned vs loose songs, album order, offline artwork fallbacks |
| `library-items` | unified Library tiles: badges/full/partial marks, no downloaded-playlist duplicates, album coverage, orphan snapshots |
| `startup` | login-item payloads: dev no-op, Windows path/args, macOS bundle, unsupported platforms; defaults |
| `listening` | seven-day summaries, duration weighting, duplicate history, history rows and their artist/release links |
| `artist-credits` | credit parsing: the leading artist run, separator trimming, conservative splitting of combined names, structured credits winning over the fallback |
| `track-title` | recording identity: official video/audio/lyric/4K markers ignored, live/remix/acoustic kept distinct, case and spacing normalised |
| `pixel-scramble` | dot-matrix boot: random digits, fixed colon, left-to-right lock order and the final landed value |
| `images` | saved-library artwork cache: content addressing, dedupe, bulk resolution, stats, clear |
| `network` | connectivity state machine with injected link/probe: offline, unreachable debounce, recovery, manual mode, dev override |
| `discord` | Discord Rich Presence: IPC frame codec, pipe discovery, activity mapping (art fallbacks, truncation, timestamps), rate limiter, and the client against a fake Discord socket |
| `version` | SemVer ordering for update checks: prereleases, `v` prefix, build metadata, invalid tags |
| `updates` | update state machine with fake adapters: offline, macOS manual download, Windows download/install, overlapping checks, cancel, skipped versions, Ed25519 manifest verification, signed-hash hand-off |
| `release-notes` | release-notes lint: allowed sections, empty/missing/duplicate sections, internal jargon, CRLF |
| `changelog` | baking release notes from tags (sections, plain text, ordering, never ahead of the running version, release links) and which notes a launch shows (first install, upgrade from before the sheet, seen-but-never-shown catch-up, seen/shown baselines) |

### Manual update smoke test (Windows, real hardware)

The unit suite proves the state machine; only this proves NSIS can replace a
running per-user install on a real machine.

1. Install the current release (`Viby-windows-x64.exe`) and launch it.
2. Open Settings → Updates → **Check for updates**. With no newer release it
   must say "You're up to date".
3. Bump `package.json`, tag and push a newer `v*` release; wait for it to go
   live.
4. In the installed build: check → **Download**. The progress bar must advance
   and reach 100%, then Viby must quit, install and relaunch by itself — no
   second click and no installer wizard.
5. Confirm Viby reopens on the new version (`Settings → Updates` shows the new
   current version) and that the What's New sheet names it with its notes. If
   the previous version's sheet never appeared, that version's notes must be in
   the sheet too. Closing it must record the version, so a restart does not
   show it again.
6. Open `%APPDATA%\Viby\logs\updater.log`; it must contain the check, download
   and install entries with no verification errors.
7. Cancel path: start a download, click **Cancel**, then download again. The
   first attempt must stop and the second must complete.
8. Integrity path: publish a build whose `update-manifest.json` does not match
   its installer (or temporarily edit the manifest asset); the download must be
   deleted and the state must show the verification failure, never install.

Verified on Windows 11 (2026-10-25, Electron 45): the NSIS installer replaced the
running per-user install and relaunched successfully. The silent update path
(`--updated /S --force-run`) was re-verified on 2026-10-28; the full in-app
hand-off still needs a newer published release to exercise. Windows 10 uses the
same x64 build and is covered by the Windows 11 pass by maintainer decision.
Re-run this after any updater change.

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
| `home` | recent history rows, the history panel, weekly listening stats (pixel clock with HRS/MIN units, no chart or progress bars), the one-shot scramble on return, mood icons and mood pages |
| `carousel` | rails hide their scrollbar, header chevrons page the row, the wheel scrolls sideways on Windows |
| `changelog` | after an update the What's New sheet shows the running version's notes once, includes a version marked seen without a sheet, caps a multi-version jump at three with the earlier count, Escape/Close dismiss it, and Settings reopens it |
| `shortcuts` | Space, transport/seek/volume keys, mute/shuffle/repeat/like, Escape, `/`, and text-field guards |
| `playback` | start, seek a cached file, auto-advance, dock sync, quality tag |
| `playback-failure` | media errors stop the fake Pause, retry a fresh source, and recover from a local download or show a visible error |
| `reconnect` | a dead source on resume shows the spinner and re-resolves |
| `autoplay` | radio extension when the queue ends |
| `links` | player-bar title → song page, artist link, related list, every credited artist linked in the dock |
| `release-focus` | song row/card bodies play while only the title text opens the release at the row and flashes it; a single opens the song page; queue titles follow; release names stay links |
| `lyrics` | panel opens docked beside the page, page width shrinks and restores, synced active line, click-to-seek, closes |
| `queue` | queue docks beside the page, count and Clear, grip reorder by pointer and keyboard, remove, empty state, lyrics sharing the panel, and dragging any song row onto the empty queue / a slot / the drop bar / the queue button |
| `lyrics-change` | a new track's lyrics reset to the top (no inherited scroll) |
| `library` | playlists and saved releases appear, open, and delete cleanly |
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

Queue editing and reordering, `insertAt` for drag-to-queue, repeat modes, shuffle, favourites,
history, media session. It owns the queue for its duration and restores settings afterwards.

## Impact map

Find the row for what you changed; run what it lists.

| You changed | Run |
|---|---|
| `src/main/ytdlp/**` | unit `resolver` (incl. the data-saver ceiling) · e2e `playback` |
| `src/main/innertube/**` | unit `innertube`, `catalog`, `thumbs` · e2e `images`, `navigation`, `home` |
| `src/main/lyrics.ts` | unit `lyrics` · e2e `lyrics` |
| `src/main/import/**` | unit `import`, `spotify` · e2e `import` |
| `src/renderer/components/ImportView.svelte` | e2e `import` |
| `src/main/library.ts` | unit `library` · e2e `library` · behaviour |
| `src/main/session.ts` | e2e `resume` |
| `src/main/cache/**`, `src/main/media.ts`, `viby-media://` handler | e2e `playback`, `resume` |
| `src/main/settings.ts`, `src/renderer/components/SettingsView.svelte` | unit `startup` · e2e `settings`, `playback` (volume restore) · behaviour |
| `src/main/startup.ts`, `src/main/index.ts`, `src/main/windows.ts` | unit `startup` · e2e `settings` |
| `src/main/updater*.ts`, `release-feed.ts`, `update-manifest.ts`, `src/renderer/lib/updates.svelte.ts` | unit `version`, `updates` · manual update smoke test (Windows) |
| `.github/workflows/release.yml`, `scripts/check-release-notes.mjs` | unit `release-notes` · inspect the draft release body on the next tag |
| `src/main/json-store.ts` | unit `library` · e2e `library`, `resume` |
| `src/main/downloads/**`, `src/main/network.ts` | unit `downloads-store`, `downloads-manager`, `network` · e2e `offline`, `playback` |
| `src/renderer/lib/download-jobs.ts`, `DownloadPanel.svelte`, `SidePanel.svelte` | unit `download-jobs` · e2e `queue`, `lyrics` (shared panel shell) · visual check of the downloads panel |
| `src/renderer/lib/downloads.svelte.ts`, `src/renderer/lib/network.svelte.ts`, `OfflineHome` | e2e `offline`, `playback`, `navigation` · unit `download-groups` |
| `src/renderer/lib/library-items.ts`, `LibraryView`, `DownloadBadge`, `saved-albums.svelte.ts` | unit `library-items` · e2e `offline`, `library` |
| `src/renderer/lib/artwork.svelte.ts`, `src/main/cache/images.ts` | unit `images` · e2e `offline`, `images` |
| `src/main/ipc.ts` | depends on the handler; if the request/response shape changed → **everything** |
| `src/renderer/lib/player.svelte.ts` | e2e `playback`, `playback-failure`, `reconnect`, `autoplay`, `resume`, `links`, `queue` · behaviour · unit `artist-credits`, `listening` |
| `src/main/updater.ts`, `src/main/updater-native.ts` | unit `updates` · packaged Windows update check (silent install + relaunch) |
| `src/main/changelog.ts`, `src/renderer/lib/changelog.svelte.ts`, `ChangelogDialog`, `scripts/build-changelog.mjs` | unit `changelog`, `release-notes` · e2e `changelog`, `settings` |
| `src/shared/version.ts`, `src/main/version.ts` | unit `version`, `updates`, `changelog` |
| `src/renderer/lib/nav.svelte.ts`, `src/renderer/lib/release.ts` | e2e `navigation`, `links`, `release-focus` · unit `track-title` |
| `src/renderer/components/SearchBar.svelte`, `src/renderer/components/SearchView.svelte`, `src/renderer/lib/search.svelte.ts` | e2e `quick-search`, `navigation`, `links`, `shortcuts`, `release-focus` |
| `src/renderer/lib/lyrics.svelte.ts`, `LyricsPanel.svelte` | e2e `lyrics`, `lyrics-change` |
| `src/renderer/lib/side-panel.svelte.ts`, `SidePanel`, `QueuePanel` | e2e `queue`, `lyrics`, `lyrics-change`, `release-focus` · behaviour (reorder) |
| `src/renderer/lib/history.svelte.ts`, `HistoryPanel`, `favorites.svelte.ts` | unit `listening` · e2e `home`, `queue` · behaviour |
| `src/renderer/components/MoodGrid.svelte`, `MoodView.svelte`, `src/renderer/lib/moods.svelte.ts` | unit `innertube` · e2e `home`, `navigation`, `carousel` |
| `src/renderer/lib/playlists.svelte.ts`, `LibraryView`, `CollectionView`, `PlaylistPicker` | e2e `library` · behaviour |
| `src/renderer/lib/artist.ts` | e2e `links`, `navigation` |
| `src/shared/artist-credits.ts`, `ArtistLinks`, `src/renderer/lib/track.ts` | unit `artist-credits`, `listening`, `import`, `downloads-store` · e2e `links`, `playback` |
| `src/shared/track-title.ts`, title navigation metadata | unit `track-title`, `innertube`, `listening` · e2e `release-focus` |
| `src/renderer/components/TrackRow.svelte` | e2e `links`, `navigation`, `lyrics`, `home`, `shortcuts`, `release-focus`, `queue` · visual check |
| `src/renderer/lib/track-drag.svelte.ts`, `toast.svelte.ts`, `QueueDropBar` | e2e `queue` · native drag via CDP `Input.setInterceptDrags` |
| `src/renderer/components/PlayerBar.svelte` | e2e `playback`, `links`, `lyrics`, `queue` |
| `src/renderer/lib/rail-fit.ts` | unit `rail-fit` · e2e `carousel`, `images`, `home` |
| `src/renderer/lib/keyboard.ts` | e2e `shortcuts` · behaviour |
| `src/renderer/components/HomeView.svelte`, `MediaCard` | e2e `navigation`, `images`, `carousel`, `release-focus` |
| `src/renderer/components/DetailView.svelte`, `ListeningDashboard.svelte` | e2e `navigation`, `home`, `carousel`, `library`, `release-focus` · unit `listening` |
| `src/renderer/components/PixelClock.svelte`, `src/renderer/lib/pixel-scramble.ts` | unit `pixel-scramble` · e2e `home` |
| `src/renderer/components/TrackView.svelte` | e2e `links` |
| `src/renderer/components/Icon.svelte`, `Cover.svelte` | e2e `images` · visual check |
| `src/renderer/App.svelte` | all e2e (layout, routes, panels) |
| `src/main/discord/**` | unit `discord` · manual Discord check (Listening label, album art, Get Viby button, pause clears) |
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
- **`npm run measure`** is macOS-only (`ps` and macOS process paths). **`npm run icons`** runs on Windows too: the script writes the `.icns` itself (Pillow, no `iconutil`) and only needs Python 3 + Pillow.
- The unit runner (`tests/unit.mjs`) now resolves esbuild via Node and writes
  bundles to the OS temp dir, so it runs on Windows too.

## What the suites cannot check

- **The OS media keys / Now Playing panel** — needs a human.
- **Discord Rich Presence as friends see it** — the fake-socket unit test proves the
  protocol, but the Listening label, album art, buttons (which only other users
  can see) and pause-clears need a real Discord client and a second account.
- **Window drag/resize** — needs a human (the drag strip's computed style is
  asserted, but not that the window moves).
- **Memory/CPU budget** — `npm run measure` against the packaged app (run `npm run dist:dir` first). It samples RSS/CPU per process across idle, playback, lyrics and a 2-minute soak.
- **Login-item registration and a minimized login launch** — need a packaged build. Check Login Items (macOS) or Startup apps (Windows), sign out/in, and confirm Viby starts (minimized when that toggle is on). Dev runs never touch the OS login items.
- **Packaging** — run `npm run dist:dir`, launch the app in `dist/mac/`, play a
  track, and confirm `ps` shows `Viby.app/Contents/Resources/python/bin/python3`
  running `yt-dlp-src/__main__.py`. That is the "no system Python" proof.
- **Audio actually audible** — tests mute; a human must listen.
- **In-place Windows updates** — the state machine is unit-tested with fakes;
  NSIS replacing a running install needs the manual smoke test above.
