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

### E2E scenarios (app must be running)

```bash
VIBY_DEBUG_PORT=9222 npm run dev      # in one terminal
node tests/e2e/run.mjs lyrics         # targeted
node tests/e2e/run.mjs                # all scenarios
```

Scenarios are independent; each sets up its own state and cleans up. They play
**silently** (volume 0, muted) and restore your settings when finished. Don't use
the app while they run — they own the queue.

| Scenario | Covers |
|---|---|
| `images` | Home artwork actually renders, no broken images |
| `playback` | start, seek a cached file, auto-advance, dock sync, quality tag |
| `reconnect` | a dead source on resume shows the spinner and re-resolves |
| `autoplay` | radio extension when the queue ends |
| `links` | player-bar title → song page, artist link, related list |
| `lyrics` | panel opens, synced active line, click-to-seek, closes |
| `lyrics-change` | a new track's lyrics reset to the top (no inherited scroll) |
| `library` | playlist create/list/open/delete |
| `resume` | session save → reload → restored paused at the timestamp |
| `navigation` | drag strip, artist banner + monthly listeners, artist page from search, Back restores search |
| `settings` | sidebar entry, quality/autoplay/cache-cap persist, clear control |
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
| `src/main/json-store.ts` | unit `library` · e2e `library`, `resume` |
| `src/main/ipc.ts` | depends on the handler; if the request/response shape changed → **everything** |
| `src/renderer/lib/player.svelte.ts` | e2e `playback`, `reconnect`, `autoplay`, `resume`, `links` · behaviour |
| `src/renderer/lib/nav.svelte.ts` | e2e `navigation`, `links` |
| `src/renderer/lib/lyrics.svelte.ts`, `LyricsPanel.svelte` | e2e `lyrics`, `lyrics-change` |
| `src/renderer/lib/playlists.svelte.ts`, `LibraryView`, `CollectionView`, `PlaylistPicker` | e2e `library` · behaviour |
| `src/renderer/lib/search.svelte.ts`, `SearchView.svelte` | e2e `navigation` |
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

## What the suites cannot check

- **The OS media keys / Now Playing panel** — needs a human.
- **Window drag/resize** — needs a human (the drag strip's computed style is
  asserted, but not that the window moves).
- **Memory/CPU budget** — `npm run measure` against the packaged app (run `npm run dist:dir` first). It samples RSS/CPU per process across idle, playback, lyrics and a 2-minute soak.
- **Packaging** — run `npm run dist:dir`, launch the app in `dist/mac/`, play a
  track, and confirm `ps` shows `Viby.app/Contents/Resources/python/bin/python3`
  running `yt-dlp-src/__main__.py`. That is the "no system Python" proof.
- **Audio actually audible** — tests mute; a human must listen.
