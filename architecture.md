# Viby — Architecture

Status: current as of **0.5.3** (2026-10-28). This document describes how the code is
organized and how data moves. Product decisions, history and performance measurements
live in [PLAN.md](PLAN.md); this is the map for finding and changing code.

Suggested reading order: [README.md](README.md) (what Viby is) → this file (how it
fits together, including the full function/symbol map) → [PLAN.md](PLAN.md) (why
decisions were made) →
[TESTING.md](TESTING.md) (what to run) → [CIRULES.md](CIRULES.md) (commit/release
rules).

## Contents

1. [At a glance](#1-at-a-glance)
2. [Process model](#2-process-model)
3. [Repository map](#3-repository-map)
4. [Main process](#4-main-process)
5. [Renderer](#5-renderer)
6. [Persistence map](#6-persistence-map-userdata)
7. [Data flows](#7-data-flows)
8. [Testing map](#8-testing-map)
9. [Build and release](#9-build-and-release)
10. [Extension checklists](#10-extension-checklists)
11. [Known structural debt](#11-known-structural-debt)
12. [Function and symbol map](#12-function-and-symbol-map)
13. [Invariants worth protecting](#13-invariants-worth-protecting)

---

## 1. At a glance

Viby is an Electron desktop music player:

- **Catalog:** YouTube Music through InnerTube (metadata, search, browse, home).
- **Playback:** `yt-dlp` resolves direct audio URLs; a bounded local cache and
  explicit downloads make replays instant and offline playback possible.
- **Library:** favorites, playlists, saved releases, history, downloads and settings
  are local JSON files. No account is required.
- **Lyrics:** LRCLIB first, `lyrics.ovh` as plain-text backup, cached locally.
- **Import:** Spotify, Apple Music, Deezer, YouTube Music and SoundCloud playlist
  links; tracks are matched against the YouTube Music catalog.
- **OS integration:** media keys / Now Playing via `navigator.mediaSession`,
  Windows taskbar thumbnail controls, tray/menu-bar background playback,
  launch at login, signed updates, Discord Rich Presence.

```
┌──────────────────────────── Main process (Node) ────────────────────────────┐
│ index.ts ─ windows.ts ─ lifecycle.ts ─ background.ts ─ startup.ts ─ menu.ts │
│                                                                             │
│ ipc.ts  (the only handler layer; owns the singleton services below)         │
│   ├── innertube/     catalog: search, browse, home, moods, radio            │
│   ├── ytdlp/         runtime provisioning, resolve, cache/download fallback │
│   ├── cache/         audio LRU, image cache, cache policy                   │
│   ├── downloads/     index, reference counting, queue, art, lyrics          │
│   ├── import/        link detection, adapters, matcher                      │
│   ├── lyrics.ts      LRCLIB → lyrics.ovh                                    │
│   ├── library.ts     favorites, history, playlists, saved albums            │
│   ├── network.ts     connectivity + manual offline                          │
│   ├── media.ts       viby-media:// local files with byte ranges             │
│   ├── updater*.ts    signed updates + release feed                          │
│   └── discord/       zero-dependency local Rich Presence client             │
└─────────────────────────────────────────────────────────────────────────────┘
                  ▲ typed IPC (contextBridge, no Node in renderer)
                  ▼
┌──────────────────────────── Renderer (Chromium) ────────────────────────────┐
│ Svelte 5 + Vite runes                                                       │
│ App.svelte: titlebar · icon rail · routed content · side panel · dock       │
│ lib/: player, nav, downloads, favorites, history, playlists, artwork, ...   │
│ components/: views, rows, cards, lyrics, queue, player, dialogs             │
│ single <audio> element + navigator.mediaSession                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The main rule:** the renderer never touches Node, the filesystem or an API
directly. It asks `window.viby` (the preload API) and main does the work. The
renderer may still load HTTPS images and media URLs that main supplies through
`<img>`/`<audio>`; it has no arbitrary `fetch`/WebSocket access. The one shared
contract is [`src/shared/ipc.ts`](src/shared/ipc.ts).

---

## 2. Process model

### Main process

| File | Responsibility |
|---|---|
| `src/main/index.ts` | Single-instance lock, userData pinning, privileged `viby-media` scheme, Chromium background-playback switches, startup order, quit/cleanup, packaged CSP, Discord init. |
| `src/main/windows.ts` | The single `BrowserWindow`: no native titlebar, macOS traffic lights, Windows titlebar overlay, security settings, navigation/new-window restrictions, permission denial. |
| `src/main/lifecycle.ts` | `quitting` / `backgroundReady` flags shared by close-to-tray and quit paths. |
| `src/main/background.ts` | Tray/menu-bar icon, Open/Settings/Quit, close-hides-to-tray. |
| `src/main/startup.ts` | Login item registration; `--launch-at-login`; minimized launch detection. |
| `src/main/menu.ts` | Application menu; packaged Windows/Linux get no native menu bar. |
| `src/main/taskbar.ts` | Windows thumbnail toolbar (previous/play/next), taskbar progress/overlay. |
| `src/main/ipc.ts` | Every IPC handler, the playback pipeline, singleton service instances, media protocol handler, download broadcasts. |
| `src/main/media.ts` | `viby-media://` URL helpers, MIME mapping. |

### Preload

`src/preload/index.ts` exposes exactly one object, `window.viby`, typed as
`VibyApi` from `src/shared/ipc.ts`. It contains no business logic and no Node
globals. Adding a capability means updating the shared interface, the preload
bridge, and a main handler together.

### Renderer

Svelte 5 with runes. State lives in small stores under `src/renderer/lib/`, views
and reusable pieces under `src/renderer/components/`. There is one `<audio>`
element for the whole app.

### Shared

`src/shared/` contains types and pure functions used on both sides:

| File | Contents |
|---|---|
| `types.ts` | `Track`, `Playlist`, `CatalogItem`, `Settings`, `DownloadsSnapshot`, `PresenceSnapshot`, IPC result types, etc. |
| `ipc.ts` | `CH` channel names and the `VibyApi` contract. |
| `artist-credits.ts` | Credit parsing/splitting; keeps every featured artist linkable. |
| `track-title.ts` | Recording identity: strips official-video/lyric/4K markers, keeps live/remix/acoustic distinct. |
| `listening.ts` | Seven-day listening summary and history-row construction. |
| `changelog.ts` | Types for baked release notes. |
| `version.ts` | SemVer ordering for update checks. |

---

## 3. Repository map

```
src/
├── main/                 main process (see §4)
│   ├── cache/            audio LRU + image cache + cache policy
│   ├── discord/          Rich Presence IPC client
│   ├── downloads/        store + manager + art
│   ├── import/           detection, adapters, matcher, bounded HTTP
│   ├── innertube/        YouTube Music catalog client/parser/constants
│   └── ytdlp/            runtime provisioning, process execution, resolver
├── preload/              contextBridge only
├── renderer/             Svelte app (see §5)
│   ├── components/       views, rows, cards, panels, dialogs
│   ├── lib/              stores, helpers, API wrapper
│   └── styles/           design tokens and global CSS
└── shared/               cross-process types and pure helpers

tests/
├── unit.mjs              Node suite runner
├── *.test.ts             unit/integration suites (some live)
├── behaviour.mjs         queue/player/media-session behaviour
└── e2e/                  CDP scenarios against the running app

scripts/                  runtime fetch, icons, changelog, update manifest, measure
resources/                icon, tray, thumbar, yt-dlp zipapp, Python runtime, plugins
docs/                     import research + README screenshots
```

### Start here by task

| I need to change… | Start at |
|---|---|
| Playback, queue, shuffle/repeat, resume | `src/renderer/lib/player.svelte.ts`, then `resolveForPlayback()` in `src/main/ipc.ts` |
| A track row, card or title/artist link | `components/TrackRow.svelte`, `MediaCard.svelte`, `shared/artist-credits.ts`, `lib/track.ts` |
| A routed page or navigation behavior | `lib/nav.svelte.ts`, `App.svelte`, the view in `components/` |
| Catalog/search parsing | `src/main/innertube/parse.ts`, `client.ts`, `shared/types.ts` |
| Stream resolution / yt-dlp behavior | `src/main/ytdlp/resolver.ts`, `binary.ts`, `exec.ts` |
| The audio or artwork cache | `src/main/cache/audio.ts`, `images.ts`, `policy.ts` |
| Downloads (queue, ownership, pruning, active panel) | `src/main/downloads/store.ts`, `manager.ts`, `lib/downloads.svelte.ts`, `lib/download-jobs.ts`, `DownloadPanel.svelte` |
| Favorites, history, playlists, saved albums | `src/main/library.ts`, `shared/listening.ts`, `lib/history.svelte.ts`, `lib/playlists.svelte.ts` |
| Offline mode / local-first UI | `src/main/network.ts`, `lib/network.svelte.ts`, `OfflineHome.svelte` |
| Lyrics fetching or the panel | `src/main/lyrics.ts`, `lib/lyrics.svelte.ts`, `LyricsPanel.svelte` |
| Playlist import | `src/main/import/index.ts`, adapters, `matcher.ts`, `ImportView.svelte` |
| Updates / release notes | `src/main/updater*.ts`, `release-feed.ts`, `SettingsView.svelte`, `scripts/build-changelog.mjs` |
| Discord Rich Presence | `src/main/discord/`, `lib/player.svelte.ts` (`setPresence`), `SettingsView` |
| Window chrome, tray, login, taskbar | `src/main/windows.ts`, `background.ts`, `startup.ts`, `taskbar.ts` |
| Security boundaries | `windows.ts`, `index.ts` (CSP), `ipc.ts`, `bounded-body.ts`, `import/http.ts` |
| A new setting | `shared/types.ts` → `settings.ts` → `SettingsView.svelte` → the consumer |
| A new IPC call | `shared/ipc.ts` → `preload/index.ts` → `ipc.ts` → `lib/api.ts` |
| Tests for a change | [TESTING.md](TESTING.md) impact map and e2e table |

---

## 4. Main process

### 4.1 Startup and quit

`src/main/index.ts`:

1. Registers `viby-media` as a privileged, standard, secure scheme.
2. Requests a single-instance lock. A second launch shows the existing window.
3. On `ready`: installs menu, production CSP, touches settings once, applies
   login-item and Discord settings, registers IPC/taskbar, creates the window,
   applies tray behavior.
4. On `before-quit`: marks quitting (so close-to-tray stops hiding), stops Discord,
   and lets normal shutdown proceed.
5. A second close on Windows/Linux quits unless background playback is actually
   available (tray created), tracked by `lifecycle.ts`, not just the setting.

### 4.2 IPC router (`src/main/ipc.ts`)

Every renderer capability is a handler here. The file also owns the singleton
services:

- `Resolver`, audio/image caches, downloads store/manager, track metadata store
- active resolve / prefetch controllers
- power-save blockers for playback and downloads
- media protocol handler

Channel groups in `src/shared/ipc.ts`:

| Group | Examples |
|---|---|
| app / settings / session | `app:changelog`, `settings:get`, `session:set` |
| player | `player:resolve`, `player:prefetch`, `player:state`, `player:presence`, `player:taskbar` |
| catalog | `catalog:search`, `catalog:browse`, `catalog:home`, `catalog:moods`, `catalog:radio`, `catalog:audio-track`, `catalog:artist-image` |
| library | favorites, playlists, saved albums, history |
| cache / images | stats, clear, `images:cache`, `images:data-url` |
| network | get, set mode, recheck, `network:changed` |
| updates | get, check, download, cancel, install, `updates:changed` |
| downloads | snapshot, add track/collection, remove/prune, retry/cancel, pause/resume (track and collection), progress events |
| yt-dlp / import | runner info/update, import resolve/match/create/cancel/progress |

Validation lives at this boundary: unknown/non-string IDs, non-boolean settings,
bounded names and presence snapshots are rejected or normalized here.

### 4.3 Playback resolution pipeline

`resolveForPlayback()` in `ipc.ts` is the authoritative order:

```
1. Explicit download for this video id?  → play the local file, no network.
   (Skipped for a forced recovery from a failed local file.)
2. Audio cache hit?                       → play the cached file.
   (Skipped on force, except while offline, where cache is the fallback.)
3. Offline and no local file?             → "This song isn't downloaded."
4. yt-dlp resolve direct HTTPS URL        → play it; start background caching
   if the track is cache-worthy.
5. No direct URL (SABR-only)              → download to disk, then play the file.
```

The renderer resolves only when playback actually starts. Opening a 100-track
album costs zero resolver calls; prefetch warms the next/hovered tracks.

### 4.4 Catalog (`src/main/innertube/`)

- `client.ts` — InnerTube calls: `search`, `moodCategories`, `artistImage`,
  `audioTrackFor`, `browse`, `playlistItems`, `radio`, `home`.
- `parse.ts` — turns InnerTube renderers into `CatalogItem`/`Shelf`/`BrowseResult`.
  This is where release type, artist/album links, play counts and audio/video
  classification are extracted.
- `constants.ts` — API key, client version, endpoints; patchable without touching
  the call sites.

The renderer never sees raw InnerTube JSON, only shared catalog types.

**Entity identity.** Catalog rows carry artist and release page ids. A track
rebuilt from history, downloads or a resolver may know only a name, and release
titles are not unique across artists. Name-only links therefore verify a search
result against the title *and* the credited artist (`entity-lookup.ts`); an
unverified name opens the matching search results instead of the first hit.
`tracks.json` merges catalog-first (`track-metadata.ts`), so resolver metadata
can add a duration or artwork but never erase the ids a link needs.

**Song-title clicks are album-first.** A track's tagged album or EP opens at the
song. When the tag is a single, or the row is a search result with no release,
`release.ts` searches albums by the cleaned song title and artist, skips singles,
browses the candidates and keeps only one whose track list contains the same
recording. The matched row is scrolled into view and flashed. `pickTrackIndex`
prefers the exact row id, then a version-aware title key, then duration within
8 seconds, so a duplicate title cannot light up the wrong recording. A song with
no album behind it opens the song page.

### 4.5 Resolver (`src/main/ytdlp/`)

- `binary.ts` provisions and updates the resolver. A bundled zipapp + vendored
  CPython (`resources/`) is copied into `userData/bin/` so `yt-dlp` is writable
  and self-updatable. `YtDlpInfo` reports the actual runner.
- `exec.ts` runs commands with argument arrays (no shell), timeouts and
  line-streaming for progress.
- `resolver.ts` resolves formats, filters to playable progressive HTTPS audio,
  caches URLs for two hours, caps concurrency, and falls back to download-to-cache
  when no direct URL exists.

### 4.6 Caches (`src/main/cache/`)

- `audio.ts` — bounded LRU file cache with its own `index.json`. `lookup`,
  `touch`, `put`, `evict(keepId)`, `clear(keepId)`. The currently loaded track is
  never evicted.
- `images.ts` — content-addressed artwork cache (`sha1` filename), guarded remote
  fetches with manual redirects and public-host checks, batch cap enforcement.
- `policy.ts` — cache-worthiness: favorited, in an owned playlist, ≥50% played,
  or played twice.

### 4.7 Downloads (`src/main/downloads/`)

- `store.ts` — the downloads index: `entries` (one per track), `collections`
  (album/playlist/liked), `jobs` (queued/paused work). Entries are
  reference-counted by source keys (`track:<id>`, `album:<id>`, `playlist:<id>`,
  `liked`). A file is removed only when no source references it and it is not the
  loaded track. A malformed index pauses the orphan sweep and writes a recovery
  marker instead of deleting files.
- `manager.ts` — a single-worker queue with progress throttling, retry/backoff,
  transient-vs-permanent failure classification, pause/resume across offline
  transitions, art and lyric capture, and completion notifications. A user
  pause is recorded on the job (`pausedByUser`), so restarting the app or
  reconnecting does not resume it; the partial file stays for a later resume.
  Video/ugc
  rows download the official audio release when the catalog knows one
  (`downloadIdFor`), so an unavailable music video cannot fail the download and
  the saved file is the released audio rather than a video soundtrack.
- `art.ts` — download-specific artwork helpers.

Downloaded files live under `userData/downloads/` (`audio/`, `art/`, `lyrics/`,
`tmp/`) and are never auto-evicted. Cancelling a collection removes source
references from pending jobs, aborts the active job, deletes only jobs with no
other owner, cleans their staging directories, and keeps completed songs; an
otherwise-empty collection record is removed.

### 4.8 Library, session, settings, stores

- `json-store.ts` — atomic JSON store (temp file + rename). Loads defaults and
  merges stored values; self-heals on corrupt data.
- `library.ts` — `library.json`: favorites, history (5,000-play cap), playlists,
  saved albums. Validates and heals malformed entries on read.
- `session.ts` — `session.json`: current track, up to 100 queue entries, index,
  position, timestamp; used to reopen paused where you left off.
- `settings.ts` — `settings.json`: defaults, sanitization, first-run detection,
  quality cap helper, changelog baselines.

### 4.9 Lyrics (`src/main/lyrics.ts`)

1. LRCLIB `/get` with title, artist, album, duration.
2. LRCLIB `/search`, closest duration, synced preferred.
3. `lyrics.ovh` plain text.
4. `none`.

Results, including misses (24h retry), are cached in `lyrics.json`. Responses are
streamed through the bounded body reader.

### 4.10 Import (`src/main/import/`)

`detect.ts` identifies the service from a pasted link, checking public HTTP(S)
targets and following short-link redirects safely. Adapters:

| Service | Adapter |
|---|---|
| YouTube Music / YouTube | `youtube.ts` (exact ids, no search) |
| Deezer | `deezer.ts` (public API) |
| Spotify | `spotify.ts` (anonymous embed token + pathfinder pagination; embed fallback) |
| Apple Music | `apple.ts` (share-page JSON) |
| SoundCloud | `soundcloud.ts` (web player client id) |

`matcher.ts` matches source tracks to YouTube Music by title, artist and duration;
uncertain rows go to the review UI, never silently replaced. `http.ts` performs
guarded, bounded, retrying HTTP; `bounded-body.ts` is shared with lyrics/updates.

### 4.11 Connectivity (`src/main/network.ts`)

`NetworkMonitor` combines `navigator.onLine`/power resume/probes with a manual
offline switch. Two failed probes make the app local-first. It exposes
`network:changed`; the renderer store drives the offline Home, search gating,
titlebar pill and download behavior.

### 4.12 Media protocol (`src/main/media.ts` + `ipc.ts`)

Local audio is served over `viby-media://local/<encoded absolute path>` rather
than `file://`, keeping `webSecurity` on. The handler:

- resolves the real path and confirms it is under `userData/cache` or
  `userData/downloads` (symlinks included);
- supports byte ranges so the scrubber can seek;
- maps extensions to MIME types.

### 4.13 Updates and releases

- `updater.ts` — platform-agnostic state machine (`idle`, `checking`,
  `up-to-date`, `available`, `downloading`, `ready`, `manual`, `error`).
- `updater-native.ts` — Electron/NSIS path for Windows in-place updates.
- `release-feed.ts` — GitHub release metadata for macOS; selects the correct DMG.
- `updater-manual.ts` — downloads and opens the macOS DMG (unsigned builds cannot
  self-update).
- `update-manifest.ts` / `update-key.ts` — Ed25519-signed manifest verification;
  a pinned key fails closed if the manifest is missing, malformed or mismatched.
- `update-manifest.mjs` script + release workflow sign the manifest; the release
  tag message is baked into `resources/changelog.json` for the in-app What’s New
  sheet.

The settings icon carries a dot while an update is pending. Opening Settings from
that icon scrolls to the Updates section and flashes its card, which shows the
version transition, a status badge and one solid action.

### 4.14 Discord Rich Presence (`src/main/discord/`)

Zero-dependency local IPC client:

| File | Role |
|---|---|
| `frame.ts` | 8-byte little-endian header + JSON frames |
| `paths.ts` | `discord-ipc-0..9` discovery on Windows/macOS |
| `client.ts` | handshake, READY, ping/pong, pending request matching |
| `activity.ts` | activity payload: Listening type, title/artist, links, artwork, vinyl badge, **Get Viby** button |
| `rate-limit.ts` | 5 updates / 20s; sends inside the cap are immediate |
| `presence.ts` | connection lifecycle, 250ms coalescing, reconnect backoff, pause/stop clear |
| `index.ts` | public app ID, dev-only socket/badge overrides |

The renderer sends a plain `PresenceSnapshot` only on meaningful changes or a
detected seek; main projects the position from `updatedAt`. A track change
pauses the old audio while the next one resolves, but that transient stop is
not published: Discord keeps the previous card until the new track actually
starts, then switches immediately (only a user pause, stop or failure clears
it). The client ID is public; no Discord token or account is involved. Presence
is on by default and can be disabled in Settings.

### 4.15 Security model

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  `webSecurity: true`.
- Navigation and `window.open` are restricted to safe web URLs; everything else
  opens in the system browser.
- Permission requests, permission checks and device permissions are denied.
- Remote debugging is dev-only (`VIBY_DEBUG_PORT`).
- Packaged builds get a strict CSP with `connect-src 'self'`; development keeps
  the Vite WebSocket allowance.
- IPC validates/coerces boundary inputs; media paths are realpath-contained;
  image data URLs are image-only and size-capped.
- External HTTP is bounded and redirect-validated hop-by-hop; update manifests are
  signed and fail closed.
- No accounts, telemetry, analytics, cookies or bundled credentials.

### 4.16 Performance invariants

- One `<audio>` element; Chromium’s decoder is the only decode path.
- Player bar/media-session clock updates are throttled to 1 Hz; the renderer does
  not poll. Synced lyrics sample the audio element clock (`player.currentTime`)
  per animation frame, so highlighting keeps sub-second accuracy without making
  every other surface re-render four times a second.
- Audio cache 1 GB default (LRU), art cache 256 MB (LRU), both bounded. Downloads
  are user-owned and never auto-evicted.
- `yt-dlp` concurrency capped; prefetch limited; renderer stays dumb.
- DetailView and CollectionView page long track lists at 120 rows; rails lazy-load
  artwork and scale cards to whole slots.
- Cache eviction runs only on cap/quality changes; image cache cap scans run once
  per batch; resolver URL cache is pruned/capped.

---

## 5. Renderer

### 5.1 App shell

`src/renderer/App.svelte` owns the grid:

```
titlebar (full width)
sidebar rail | routed content | optional side panel
player dock (full width, fixed row)
overlays: PlaylistPicker, QueueDropBar, ChangelogDialog, toasts/errors
```

Routes are resolved in this order: `track` → `detail` → `mood` → `collection` →
top-level `view` (`home`, `search`, `library`, `import`, `settings`). The titlebar
holds Back/Forward (browser semantics), centered search, network pill and profile
placeholder.

`nav.svelte.ts` is the single navigation store: view/detail/track/collection/mood,
back and forward snapshots, and a one-shot release focus. Components navigate
through `nav`, never through callback chains.

### 5.2 Stores (`src/renderer/lib/`)

| File | Responsibility |
|---|---|
| `player.svelte.ts` | The single `<audio>`, queue, play/pause/seek/modes, session persistence, mediaSession, recovery, prefetch, autoplay/radio, audio-first swap. |
| `nav.svelte.ts` | Route state + history + release focus. |
| `downloads.svelte.ts` | Main download snapshot mirrored to runes; per-track/collection state helpers, progress events, pending/downloading getters, cancel/cancelCollection. |
| `download-jobs.ts` | Groups pending download jobs by album/playlist/EP or loose songs for the docked Downloads panel. |
| `favorites.svelte.ts` | One source for every heart/state. |
| `history.svelte.ts` | Recent history + weekly summary cache for Home/panel. |
| `playlists.svelte.ts` / `saved-albums.svelte.ts` | Library collections. |
| `lyrics.svelte.ts` | Lyrics fetch/cache state for the docked panel. |
| `artwork.svelte.ts` | Remote → local `viby-media` artwork cache queue, failed retry, clear generation guard. |
| `catalog-cache.svelte.ts` | Home shelf state, detail/radio session caches. |
| `search.svelte.ts` | Debounced search, cancellation, recents, grouping. |
| `network.svelte.ts` | Renderer view of connectivity/offline. |
| `updates.svelte.ts` / `changelog.svelte.ts` | Update state and What’s New. |
| `moods.svelte.ts` | Mood/genre tiles and pages. |
| `side-panel.svelte.ts` | `'lyrics' | 'queue' | 'history' | null`; shared docked panel. |
| `playlist-picker.svelte.ts` | Single app-wide add-to-playlist popover. |
| `track-drag.svelte.ts` | HTML5 drag payload for adding songs to the queue. |
| `toast.svelte.ts` | Transient status chips. |
| `keyboard.ts` | Global shortcuts with text-field guards. |
| `release.ts` / `album.ts` / `artist.ts` / `track.ts` | Entity navigation and catalog-item ↔ track mapping. |
| `player-source.ts` | Decides reuse/detach/resolve when the player changes tracks. |
| `quality.ts` | Codec/bitrate label shared by the dock and Discord. |
| `format.ts` | One clock-style duration formatter (handles hours). |
| `library-items.ts` / `download-groups.ts` | Library/download tiles and grouping. |
| `rail-fit.ts` | Whole-card rail sizing. |
| `pixel-scramble.ts` | One-shot dot-matrix clock animation. |

### 5.3 Components

| Group | Files |
|---|---|
| Shell | `PlayerBar`, `SidePanel`, `QueuePanel`, `LyricsPanel`, `HistoryPanel`, `DownloadPanel`, `Rail`, `SearchBar`, `PlaylistPicker`, `QueueDropBar`, `ChangelogDialog` |
| Views | `HomeView`, `OfflineHome`, `SearchView`, `LibraryView`, `CollectionView`, `DownloadCollectionView`, `DetailView`, `TrackView`, `MoodView`, `ImportView`, `SettingsView` |
| Rows/cards | `TrackRow`, `MediaCard`, `Cover`, `DownloadBadge`, `CollectionDownloadButton`, `EntityLink`, `ArtistLinks`, `SubtitleParts` |
| Home extras | `ListeningDashboard`, `PixelClock`, `MoodGrid` |
| Primitives | `Icon`, `InlineAlert` |

`TrackRow` is the most reused surface. Its title text navigates; the rest of the
row plays. Artist/album links, favorite/download/queue/remove actions and the
playing equalizer all live there.

### 5.4 Playback state machine

`Player` owns:

- queue + index, shuffle/repeat/autoplay;
- play/pause/next/previous/seek/volume/mute;
- resolve → play, with `playToken` so stale resolves cannot hijack playback;
- recovery: re-resolve with `force`/`discardCache`, two attempts, then a visible
  stopped state (`failPlayback`);
- audio-first swap: music videos are replaced with the official audio release and
  `sourceId` keeps the originating row highlighted;
- session persistence (throttled, exact saves on pause/seek/end/quit);
- `mediaSession` metadata/actions/position;
- a throttled reactive clock for the bar and OS UI, plus an exact `currentTime`
  getter the synced lyrics panel samples each frame;
- Windows taskbar control mirroring;
- autoplay radio extension and next-track prefetch.

Queue edits (`enqueue`, `insertAt`, `move`, `removeAt`) never start audio; adding
to an empty queue prepares it.

### 5.5 Side panel

`SidePanel.svelte` owns the third grid column and header. `LyricsPanel`,
`QueuePanel`, `HistoryPanel` and `DownloadPanel` are bodies switched by
`sidePanel.mode`. The downloads mode is opened from the titlebar trigger (visible
while jobs are pending) and groups jobs by album/playlist/EP, with per-item and
per-collection pause/resume and cancel. The same pause/resume toggle and a compact
cancel control sit on album and playlist headers, and a row's download button
toggles pause/resume for that song. The trigger is a single icon button using the standard
download glyph (with a gentle downward drift only while a file is actually
downloading, static when the queue is paused); it morphs into a
one-shot completion check when the queue drains, and into a persistent danger
mark when jobs failed, with a small failure dot while other work continues. The
count is deliberately left to the panel. The panel is not a route, so
Back/Forward do not record it.
Escape closes it; the playlist picker owns Escape while open.

### 5.6 Artwork

`Cover` renders a placeholder until `artwork.src()` returns a local
`viby-media://` URL. The store batches up to 8 URLs, retries failures on
reconnect, and uses a generation counter so clearing the cache cannot be undone by
an in-flight response.

### 5.7 Search

The titlebar `SearchBar` is always mounted. It debounces, cancels stale
requests, shows recents on focus and grouped quick results; Enter opens the full
Search page, clicking a song plays it alone (radio follows), artists/playlists
open their pages. The Search page reuses the same per-category calls and adds a
Top result plus category grids.

### 5.8 Interaction details

- Keyboard: `lib/keyboard.ts` handles Space, transport/seek/volume, mute, shuffle,
  repeat, like, Escape, `/` and Ctrl/Cmd+K.
- Drag: `track-drag.svelte.ts` carries a `CatalogItem`; the queue grip uses
  Pointer Events for reorder, while any row can be dropped on the queue
  button/drop bar/list.
- Scroll memory: App remembers per-view offsets; release focus skips restoration
  while it scrolls to a song.
- Reduced motion: global CSS disables transitions/decorative entrances while
  keeping status spinners/equalisers alive.

### 5.9 Styling

`src/renderer/styles/global.css` defines the monochrome design tokens: near-black
surfaces, three text weights, white accent, red errors only, one easing, radii,
dock/titlebar/sidebar dimensions, glass/scrollbar utilities. Component styles are
scoped in each `.svelte` file.

---

## 6. Persistence map (`userData`)

| Path | Owner | Contents |
|---|---|---|
| `settings.json` | `settings.ts` | Audio quality, volume/mute/modes, autoplay, background/tray, login, offline, updates, Discord, changelog baselines. |
| `library.json` | `library.ts` | Favorites, history (5,000 cap), playlists, saved albums. |
| `session.json` | `session.ts` | Current track, queue (≤100), index, position, updatedAt. |
| `tracks.json` | `ipc.ts` | Metadata snapshot for every played/cached track; offline metadata and bitrate estimation. |
| `stream-urls.json` | `ytdlp/resolver.ts` | Resolved URLs with 2h expiry; bounded. |
| `lyrics.json` | `lyrics.ts` | Cached lyrics and 24h misses. |
| `cache/audio/index.json` + files | `cache/audio.ts` | Bounded LRU audio cache. |
| `cache/art/` | `cache/images.ts` | Content-addressed artwork cache. |
| `downloads/index.json` | `downloads/store.ts` | Entries, collections, jobs. |
| `downloads/audio/`, `art/`, `lyrics/`, `tmp/` | `downloads/` | Explicit downloads and their assets. |
| `bin/` | `ytdlp/binary.ts` | Managed yt-dlp zipapp/runtime copy. |
| `pycache/` | `ytdlp/binary.ts` | Python bytecode cache. |
| `logs/updater.log` | updater | Update diagnostics on Windows. |
| `resources/changelog.json` (app bundle) | `scripts/build-changelog.mjs` | Release notes baked from annotated tags. |

All JSON stores use temp-file + rename. Corrupt/structurally invalid data is
preserved and heals only the in-memory copy where destructive cleanup could lose
user files.

---

## 7. Data flows

### Play a search result
1. `SearchBar`/`SearchView` calls `player.playItem(item)`.
2. Player builds a one-track queue and calls `api.player.resolve({ input: id })`.
3. Main follows the playback pipeline (§4.3), returns `ResolveResult`.
4. Player sets `audio.src`, metadata/mediaSession, records history on pause/end,
   persists the session, and prefetches the next track/radio.

### Play an album/playlist
1. Page builds a queue from catalog items; `player.playList(items, index)`.
2. Only the selected track resolves; the rest stay metadata.
3. Next/previous walks the queue; autoplay may append radio tracks when it ends.

### Download a collection
1. UI calls `downloads.addCollection(input, tracks)`.
2. Store enqueues jobs, dedupes against existing entries and sources.
3. Manager downloads one at a time, resolves art/lyrics, writes `index.json`,
   emits progress/changed events.
4. Cancelling an active collection aborts the current child, removes its
   pending jobs and staging files, and keeps completed songs.
5. Library/Download views read the snapshot and reference counts; removal only
   unlinks a file when the last owner goes away.

### Play offline
1. Network monitor flips local-first; Home uses `OfflineHome`, Search is gated.
2. Resolve checks explicit downloads first, then the audio cache.
3. `viby-media://` serves the local file with byte ranges.
4. Artwork comes from the image cache/download art.

### Import a playlist
1. Import view passes the pasted URL to `api.import.resolve`.
2. `detect.ts` identifies/follows the link; the adapter returns normalized tracks.
3. `matchImport` searches YouTube Music and marks auto/review/missing.
4. User reviews; `api.import.create` creates a local playlist.

### Update
1. On launch/settings, updater checks the GitHub release feed (macOS) or
   electron-updater’s `latest.yml` (Windows).
2. The signed manifest is verified against the pinned Ed25519 key; installer
   hashes must match.
3. Windows downloads/installs/relaunches silently; macOS downloads and opens the
   matching DMG.
4. The next launch shows the baked release notes once (What’s New).

### Discord presence
1. Renderer sends `player:presence` on track/play/seek changes.
2. Main builds a Listening activity, coalesces to the 5/20s limit and talks to the
   local Discord socket.
3. Pause/stop sends null; disable/quit closes the socket.

---

## 8. Testing map

| Layer | Command | What it proves |
|---|---|---|
| Unit/integration | `node tests/unit.mjs [suite]` | Pure logic and real-socket/protocol integration; some suites are live network tests. |
| E2E | `VIBY_DEBUG_PORT=9222 npm run dev`, then `node tests/e2e/run.mjs [scenario]` | Structure, state and routing in the running app via CDP. |
| Behaviour | `node tests/behaviour.mjs` | Queue editing, repeat/shuffle, favourites, history, media session. |
| Typecheck | `npm run typecheck` | Main/preload/shared `tsc` + Svelte diagnostics. |
| Build | `npm run build` | Production main/preload/renderer bundles. |
| Packaging/measure | `npm run dist:dir`, `npm run measure` | Installer/bundle behavior and CPU/RSS (macOS measurement). |

[TESTING.md](TESTING.md) is the authoritative file→suite impact map. Changes to
`src/shared/**`, `src/preload/**`, `src/renderer/lib/api.ts` or the player state
machine require the full suite. E2E plays audio muted but owns the queue; ask
before running while someone is listening.

---

## 9. Build and release

- `electron.vite.config.ts` builds main, preload and renderer separately with the
  `@shared` alias.
- `electron-builder.yml` packages `out/**`, `resources/changelog.json`, and
  `extraResources`: yt-dlp, vendored CPython, PO-token plugins, tray and thumbar
  art. macOS is ad-hoc signed (DMG only); Windows is per-user NSIS with in-place
  updates backed by the signed manifest.
- `npm run runtime` / `runtime:mac` provision the pinned CPython + yt-dlp zipapp.
- `scripts/build-changelog.mjs` bakes release notes from annotated tags;
  `scripts/check-release-notes.mjs` lints the user-facing sections.
- Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds both
  platforms, signs the update manifest and publishes the release. The annotated
  tag message becomes the GitHub release body and the in-app What’s New notes.
- Release/version rules live in [CIRULES.md](CIRULES.md).

---

## 10. Extension checklists

### Add an IPC capability
1. Add the channel and method to `src/shared/ipc.ts`.
2. Add the matching type to `src/shared/types.ts`.
3. Expose it in `src/preload/index.ts`.
4. Handle it in `src/main/ipc.ts` (validate boundary input).
5. Use it through `src/renderer/lib/api.ts`.
6. Add the mapped suite from [TESTING.md](TESTING.md); update the impact map.

### Add a setting
1. `Settings` in `src/shared/types.ts`.
2. Default + sanitization in `src/main/settings.ts`.
3. Row in `SettingsView.svelte`.
4. Apply it where it changes behavior (main and/or player).
5. Save via `api.settings.set` / `player.persistSettings`; test persistence.

### Add a library collection
1. Add the shape to `src/shared/types.ts`.
2. Extend `LibraryData`, validation, self-healing and CRUD in `src/main/library.ts`.
3. Add IPC channels/handlers/preload/renderer API.
4. Add the UI surface and tests (unit `library`, e2e where it is user-visible).

### Add a view
1. Add the `View`/`CollectionRef`/`MoodRef` variant in `nav.svelte.ts` if needed.
2. Add route precedence in `App.svelte`.
3. Build the component under `components/`.
4. Link the rail/titlebar/search entry points.
5. Add scroll memory/release focus behavior where relevant.

### Add a background task
1. Keep it in main, not the renderer.
2. Tie cleanup to `before-quit` and relevant settings changes.
3. Use timers with `unref()` where they should not hold the process.
4. Test the disable/quit path, not only the happy path.

---

## 11. Known structural debt

Date-stamped; see [PLAN.md](PLAN.md) and [TESTING.md](TESTING.md) for details.

- **yt-dlp runtime updates** are not yet verified against a pinned/signed digest;
  the app update manifest is signed, but resolver self-updates are not.
- **Session, library and `tracks.json` writes** serialize whole files on playback
  events; position-only session persistence and incremental indexes are future
  work.
- **Queue/Library list virtualization** is not done; CollectionView and DetailView
  page at 120 rows, the queue still mounts every row.
- **Downloads snapshots** are rebuilt in full and startup healing is synchronous;
  delta events and cached indexes are future work.
- **Catalog→Track mapping** is duplicated between the renderer and import matcher.
- **`registerIpc` is one ~900-line function** registering every channel; splitting it
  by domain is mechanical wiring work rather than a behavioural change.
- **Coverage gaps** remain around media range/traversal, updater-native, image
  cache redirects and full download-manager state transitions.

Keep this section short and update it when a deferred item lands; architecture
should describe the current system, not a wish list.

---

## 12. Function and symbol map

This section is the complete file-level symbol index: every named function, class,
method, constructor, getter and named arrow in the source, with its line and a
one-line role.

**Coverage:** 1,079 rows across 143 source files, generated from the code on
2026-10-28. Constructors, getters and the preload `window.viby` object arrows are
included even where a basic AST pass would miss them.

**How to use it:** find the area, then the file, then the symbol. The line number
points at the declaration in this revision; if code has shifted, search the symbol
name. Roles describe the function's job, not every branch or caller.

**Scope:** runtime/source functions and callable members. Excludes template markup,
pure data constants, `$state`/`$derived` declarations, CSS, type/interface
declarations, and tests. Test coverage lives in [TESTING.md](TESTING.md).

### 12.1 Main process — core runtime and IPC

#### src/main/background.ts

Tray icon lifecycle: builds the tray, its menu, and tracks whether background (close-to-tray) mode is safe.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | trayIconPath | function | Builds the tray icon path from packaged resources or the app's resources folder. |
| 15 | openWindow | function | Shows the main window and optionally asks the renderer to open Settings. |
| 18 | send | arrow | Sends `appOpenSettings`, waiting for the page to finish loading if needed. |
| 23 | createTray | function | Creates the tray icon and menu, then marks background mode ready; falls back safely on failure. |
| 56 | destroyTray | function | Clears background readiness and destroys the tray instance. |
| 63 | applyBackgroundPlayback | function | Creates or removes the tray so close-to-tray follows the saved setting. |

#### src/main/bounded-body.ts

Size-capped response reading: streams external bodies through a byte counter so oversized payloads are rejected mid-flight.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 6 | OversizedBodyError | class | Error type raised when a response body exceeds the allowed byte count. |
| 7 | OversizedBodyError.constructor | method | Sets the fixed message and the error name. |
| 15 | readBoundedBytes | function | Streams a response body, aborting with OversizedBodyError past the limit. |
| 51 | readBoundedText | function | Decodes a size-limited response body as UTF-8 text. |
| 58 | readBoundedJson | function | Parses a size-limited response body as JSON. |

#### src/main/changelog.ts

Reads the release notes baked into the build and filters them to the running version.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 17 | isSection | function | Type guard for a changelog section with a title and string items. |
| 27 | isEntry | function | Type guard for a stored changelog entry and its sections. |
| 39 | load | function | Reads and validates `resources/changelog.json` once, caching the entries. |
| 52 | changelogInfo | function | Returns entries not newer than the app version plus the first-run flag. |

#### src/main/image-extension.ts

Container extension for a fetched image, shared by the artwork cache and downloads.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 2 | extensionFor | function | Maps an image content type, else a URL suffix, to jpg/png/webp/gif. |

#### src/main/index.ts

Electron entry point: process hardening, single-instance lock, and startup wiring of all main-process modules.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 88 | installProductionCsp | function | Installs a strict CSP response header on the default session for packaged builds. |

#### src/main/ipc.ts

The single IPC surface: registers every channel and implements the playback resolve pipeline and media protocol.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 84 | downloadStore | function | Lazily creates the downloads store rooted at `userData/downloads`. |
| 89 | audioCache | function | Constructs an AudioCache bound to the current cache-cap setting. |
| 94 | cacheInstance | function | Returns the lazily created shared audio cache instance. |
| 100 | imageCache | function | Returns the lazily created shared artwork cache instance. |
| 107 | trackStore | function | Lazily opens `tracks.json`, the metadata map for known tracks. |
| 112 | registerIpc | function | Wires all IPC handlers for catalog, player, library, downloads, settings and updates. |
| 113 | ok | arrow | Wraps a successful payload in a `Result`. |
| 114 | fail | arrow | Converts a thrown value into a failed `Result`. |
| 118 | offline | arrow | Returns an offline failure `Result`, or null when online. |
| 138 | broadcast | arrow | Sends a payload on a channel to every live window. |
| 214 | autoCheck | arrow | Runs a quiet update check when auto-check is enabled and the app is online. |
| 223 | stopPlaybackBlocker | arrow | Releases the display-sleep blocker if one is held. |
| 303 | snapshot | arrow | Returns the current downloads snapshot from the manager. |
| 593 | historyEntries | arrow | Loads history and backfills missing metadata from the track store. |
| 805 | resolveForPlayback | function | Resolves a request to a stream via download, cache, network, or SABR disk fallback. |
| 897 | remember | function | Merges track metadata into the store, keeping catalog identity over resolver data. |
| 908 | localStream | function | Builds `StreamInfo` for a local file, deriving average bitrate from size and duration. |
| 936 | kickOffBackgroundCache | function | Opportunistically downloads a cache-worthy track so the next play is local. |
| 979 | mediaFileFor | function | Maps a media URL to a real path, only if it stays inside cache or downloads. |
| 1012 | handleMediaProtocol | function | Serves `viby-media` requests with byte-range support (200/206/416). |

#### src/main/json-store.ts

Small atomic JSON file store: temp-file writes plus rename, with corruption quarantine.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 18 | recoveryMarkerFor | function | Returns the path of the recovery marker written after a corrupt load. |
| 22 | JsonStore | class | Generic object store persisted as a JSON file with merge-on-load semantics. |
| 27 | JsonStore.constructor | method | Loads and merges the file over defaults; quarantines and flags a corrupt file. |
| 62 | JsonStore.get | method | Returns the in-memory data object. |
| 66 | JsonStore.set | method | Merges a patch, flushes to disk, and returns the merged data. |
| 73 | JsonStore.update | method | Mutates data in place through a callback, then flushes. |
| 84 | JsonStore.flush | method | Writes to a temp file and renames it over the target for atomic persistence. |
| 92 | userDataFile | function | Resolves a filename inside Electron's userData directory. |

#### src/main/library.ts

Local-first favorites, history, saved albums and playlists, with validation and healing of stored data.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 19 | isValidTrack | function | Type guard requiring a non-empty string track id. |
| 28 | isValidHistoryEntry | function | Type guard requiring a non-empty string trackId. |
| 37 | isValidPlaylist | function | Type guard requiring playlist id, name and a tracks array. |
| 47 | isValidSavedAlbum | function | Type guard requiring album id and title strings. |
| 62 | Library | class | Library facade over `library.json` for favorites, history, albums and playlists. |
| 65 | Library.constructor | method | Opens the store and repairs collections that are not arrays. |
| 88 | Library.favorites | method | Returns valid favorites, persisting a healed list when entries were dropped. |
| 101 | Library.isFavorite | method | Reports whether a track id is in favorites. |
| 105 | Library.toggleFavorite | method | Adds or removes a favorite, persists it, and returns the new state and list. |
| 121 | Library.addHistory | method | Prepends a history entry and caps stored history at 5000. |
| 131 | Library.removeHistory | method | Drops history entries whose titles match, returning the removed count. |
| 144 | Library.history | method | Returns validated history entries up to a limit, newest first. |
| 150 | Library.playCount | method | Counts history occurrences of a track id for cache-worthiness. |
| 154 | Library.bestCompletion | method | Returns the highest stored completion ratio for a track id. |
| 164 | Library.albums | method | Returns valid saved albums sorted by most recently saved. |
| 176 | Library.isAlbumSaved | method | Reports whether an album id is saved. |
| 181 | Library.toggleAlbum | method | Saves or unsaves a release with a `savedAt` stamp and returns the new list. |
| 198 | Library.playlists | method | Returns valid playlists with healed track lists, sorted by last update. |
| 218 | Library.playlist | method | Finds one playlist by id or returns null. |
| 222 | Library.createPlaylist | method | Creates a named playlist with a UUID and persists it. |
| 239 | Library.renamePlaylist | method | Renames a playlist and bumps `updatedAt`; blank names are ignored. |
| 254 | Library.deletePlaylist | method | Removes a playlist from the store. |
| 260 | Library.addToPlaylist | method | Prepends a track to a playlist unless already present; returns the update. |
| 280 | Library.addTracks | method | Appends many tracks in order with a single store write for imports. |
| 301 | Library.removeFromPlaylist | method | Removes a track id from a playlist and bumps `updatedAt`. |
| 316 | lib | function | Returns the lazily created singleton Library. |

#### src/main/lifecycle.ts

Shared quit and close flags deciding whether a hidden window is safe and whether the app may quit.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | markQuitting | function | Sets the quitting flag so a normal quit wins over close-to-tray. |
| 13 | isQuitting | function | Reports whether the app is shutting down. |
| 17 | setBackgroundReady | function | Records whether a tray exists to restore a hidden window. |
| 21 | shouldHideOnClose | function | True when a tray exists and the app is not quitting; used by the close handler. |
| 25 | keepsAppAlive | function | Same condition, used to veto quitting when all windows close. |

#### src/main/media.ts

Helpers for the privileged `viby-media` scheme used to serve local audio and artwork.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | mediaUrlFor | function | Builds an encoded `viby-media://local/...` URL for an absolute path. |
| 12 | pathFromMediaUrl | function | Extracts and decodes the absolute path from a media URL. |
| 17 | mimeForPath | function | Maps a file extension to an audio or image MIME type. |

#### src/main/menu.ts

Builds the application menu: branded on macOS, minimal in dev, removed from packaged Windows/Linux.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | installMenu | function | Installs the macOS app menu, a dev-only Edit/View menu, or no menu when packaged. |

#### src/main/network.ts

Connectivity monitor that distinguishes offline, unreachable and online using link state plus a probe.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 18 | envOverride | function | Parses the `VIBY_NETWORK_STATE` dev/test override into a status. |
| 43 | manualState | function | Builds the state for a user-forced offline mode. |
| 52 | severedState | function | Builds the state for a missing network link. |
| 61 | unreachableState | function | Builds the state for a link that exists but cannot reach the host. |
| 70 | onlineState | function | Builds the confirmed-online state. |
| 81 | NetworkMonitor | class | Debounced connectivity state machine with listeners, polling and retries. |
| 93 | NetworkMonitor.onResume | arrow | Forces a connectivity check after the OS reports a power resume. |
| 97 | NetworkMonitor.constructor | method | Accepts injectable network dependencies, defaulting to real Electron probes. |
| 99 | NetworkMonitor.start | method | Seeds state synchronously, hooks resume, then polls and probes immediately. |
| 118 | NetworkMonitor.stop | method | Clears the poll and retry timers and detaches the power hook. |
| 126 | NetworkMonitor.get | method | Returns a copy of the current network state. |
| 131 | NetworkMonitor.isOffline | method | True when forced offline or the link is down, meaning playback must not wait. |
| 136 | NetworkMonitor.isLocalFirst | method | True unless confirmed online, so the UI can show the local-first layout. |
| 140 | NetworkMonitor.onChange | method | Subscribes a listener and returns an unsubscribe function. |
| 146 | NetworkMonitor.setMode | method | Persists the offline mode setting, invalidates stale probes and re-checks. |
| 162 | NetworkMonitor.applySettings | method | Re-syncs forced-offline state after settings were written elsewhere. |
| 176 | NetworkMonitor.refresh | method | Runs a check on demand, optionally forcing the result to be trusted. |
| 180 | NetworkMonitor.overrideState | method | Maps an override status string to a full network state. |
| 186 | NetworkMonitor.check | method | Probes with generation guards, two-miss debounce and fast retry. |
| 266 | NetworkMonitor.scheduleRetry | method | Schedules a quick forced re-check after one failed probe. |
| 274 | NetworkMonitor.clearRetry | method | Cancels the pending retry timer. |
| 279 | NetworkMonitor.invalidateProbe | method | Bumps the generation so in-flight probes are discarded. |
| 286 | NetworkMonitor.set | method | Stores a new state and emits only when status, forced flag or detail changed. |
| 295 | NetworkMonitor.emit | method | Fans out a state snapshot to every registered listener. |

#### src/main/private-address.ts

SSRF guard shared by artwork fetching and import redirects; one copy so the two boundaries cannot drift.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | isPrivateAddress | function | Detects loopback, link-local, CGNAT and private IPv4/IPv6, recursing into mapped IPv4. |

#### src/main/session.ts

Playback session persistence: the last track, queue position and timestamp, restored on launch.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 18 | session | function | Lazily opens `session.json` as the playback session store. |

#### src/main/settings.ts

Settings defaults, sanitisation of user-editable values, and the lazy settings store.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 38 | asBoolean | function | Returns the value only when it is a real boolean, else the fallback. |
| 43 | sanitizePatch | function | Validates and clamps only the settings keys present in a patch. |
| 116 | isFirstRun | function | Returns whether this launch created `settings.json`, forcing store init. |
| 124 | settings | function | Lazily opens the settings store, records first run, and migrates `medium` quality. |
| 140 | setSettings | function | Sanitises and persists a settings patch, returning the merged settings. |
| 145 | qualityCapKbps | function | Returns a 64 kbps cap for data-saver, or undefined for best quality. |

#### src/main/startup.ts

Launch-at-login integration: login-item options, applying them, and detecting a login launch.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 25 | loginItemOptions | function | Builds login-item options per platform, or null when unpackaged or unsupported. |
| 50 | applyLaunchAtLogin | function | Applies login-item settings, logging and swallowing failures. |
| 62 | launchedAtLogin | function | Detects whether this process started from the OS login item. |

#### src/main/taskbar.ts

Windows thumbnail-toolbar controls (previous/play-pause/next) that mirror the player state.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 30 | iconDir | function | Returns the thumbar icon folder for packaged or dev builds. |
| 35 | loadIcons | function | Loads theme-matched thumbnail icons, cached until the Windows theme changes. |
| 43 | load | arrow | Loads one thumbnail icon or throws when the asset is missing. |
| 66 | send | function | Sends a player command to the main window if it is alive. |
| 71 | thumbarButton | function | Builds a thumbar button, adding the disabled flag only when needed. |
| 87 | applyTaskbar | function | Draws the toolbar for the current state, deferring until the window is shown. |
| 125 | setTaskbarState | function | Stores the latest player state and redraws the toolbar. |
| 133 | initTaskbar | function | Subscribes to theme updates so icons reload for light/dark taskbars. |

#### src/main/track-metadata.ts

Catalog-first merge for the remembered track store.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | mergeTrackMetadata | function | Keeps catalog identity and ids, filling only fields the resolver knows and the catalog did not. |

#### src/main/windows.ts

Creates and manages the single BrowserWindow, including navigation and permission hardening.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | getMainWindow | function | Returns the live main window or null when absent or destroyed. |
| 14 | showMainWindow | function | Restores, focuses and shows the window, recreating it if needed. |
| 25 | createWindow | function | Creates the hardened BrowserWindow, wires close/navigation guards and loads the UI. |
| 96 | sendNavigate | arrow | Sends a back/forward navigation command to the renderer if not destroyed. |
| 115 | onConsoleMessage | arrow | Forwards renderer console output to the dev terminal across Electron signatures. |
| 133 | isSafeExternal | arrow | True only for http(s) URLs, guarding `shell.openExternal`. |
| 142 | isAppNavigation | arrow | True for the app's own file URL or the dev server origin. |

### 12.2 Main process — services

Scope: cache, downloads, lyrics, innertube and yt-dlp modules under `src/main`.

#### src/main/cache/audio.ts

Bounded LRU cache for downloaded audio that indexes files in JSON and evicts by last use.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 20 | AudioCache | class | Bounded LRU cache over `<dir>/<trackId>.<ext>` files backed by a JsonStore index. |
| 23 | AudioCache.constructor | method | Creates the cache directory and opens `index.json` through JsonStore. |
| 31 | AudioCache.path | method | Getter exposing the cache directory to IPC and settings callers. |
| 36 | AudioCache.lookup | method | Returns the cached file path, or drops the index entry when the file vanished. |
| 49 | AudioCache.extOf | method | Returns the container extension recorded for a track, or null. |
| 53 | AudioCache.touch | method | Stamps `lastUsed` so LRU eviction preserves recently played tracks. |
| 65 | AudioCache.put | method | Renames a finished temp file into the cache, indexes it, then evicts. |
| 79 | AudioCache.remove | method | Deletes one cached file plus its index entry, ignoring already-missing files. |
| 93 | AudioCache.has | method | True when lookup resolves an existing cached file. |
| 97 | AudioCache.bytes | method | Sums indexed byte sizes across every cached entry. |
| 106 | AudioCache.evict | method | Unlinks least-recently-used files until under the cap, sparing `keepId`. |
| 129 | AudioCache.stats | method | Returns bytes, cap, entry count and directory as `CacheStats`. |
| 140 | AudioCache.clear | method | Unlinks every file except the playing one, then resets the index. |
| 157 | AudioCache.files | method | Private readdir helper that returns an empty list instead of throwing. |

#### src/main/cache/images.ts

Content-addressed artwork cache with SSRF guards, serving saved-library covers over the media scheme.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 27 | isRemote | function | True for http(s) URLs, meaning anything not already local. |
| 35 | assertSafeRemoteImageUrl | function | Validates scheme, host and DNS answers, throwing when an image URL could reach a private host. |
| 58 | fetchSafeRemoteImage | function | Fetches an image across up to six redirects, re-validating every hop against the SSRF guard. |
| 82 | guardedFetch | arrow | Default fetch implementation delegating to `fetchSafeRemoteImage`, injected into ImageCache. |
| 92 | ImageCache | class | Pins library artwork to disk with content-addressed names and a 256 MB cap. |
| 95 | ImageCache.constructor | method | Stores the fetch implementation (guarded by default) and creates the cache directory. |
| 103 | ImageCache.path | method | Getter returning the artwork cache directory. |
| 108 | ImageCache.nameFor | method | SHA-1 hashes the URL into `<hash>.<ext>` for content addressing. |
| 113 | ImageCache.localUrl | method | Returns a media URL when any extension variant of the image exists on disk. |
| 123 | ImageCache.localMany | method | Maps many remote URLs to the local copies that exist. |
| 132 | ImageCache.cache | method | Downloads, validates and atomically writes one image, then optionally enforces the cap. |
| 172 | ImageCache.cacheMany | method | Dedupes up to 250 URLs, caches with fixed worker concurrency, enforces the cap once. |
| 193 | ImageCache.stats | method | Sums file sizes and counts entries currently on disk. |
| 207 | ImageCache.clear | method | Removes the whole directory (tolerating Windows locks) and recreates it. |
| 217 | ImageCache.files | method | Private readdir helper that hides in-flight `.part` files. |
| 226 | ImageCache.enforceCap | method | Deletes oldest files by mtime until the cache is back under its byte cap. |

#### src/main/cache/policy.ts

Single cache-worthiness predicate deciding whether a played track is worth keeping offline.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 12 | shouldCache | function | True when a track is favorited, in an owned playlist, half played or played twice. |

#### src/main/downloads/art.ts

Caches cover art next to downloaded audio so offline views keep their artwork.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | fetchArt | function | Returns an existing hashed art name or downloads, validates and atomically writes it; never throws. |

#### src/main/downloads/manager.ts

Serial download queue that drives yt-dlp, streams progress, and repairs credits and lyrics.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 51 | numberOrUndefined | function | Parses a yt-dlp numeric field, mapping empty or `NA` values to undefined. |
| 58 | isUnknownArtist | function | True for empty or placeholder "Unknown artist" credits written by older builds. |
| 64 | normalizeTitle | function | Lowercases and collapses whitespace so titles can be matched by text. |
| 73 | parseProgressLine | function | Parses `downloaded total estimate speed` into bytes, percent and speed fields. |
| 86 | errorLine | function | Picks the last `ERROR:` line from yt-dlp stderr, with an exit-code fallback. |
| 96 | transient | function | Classifies a failure as a retryable network hiccup rather than a permanent error. |
| 109 | DownloadManager | class | One-at-a-time download queue with pause, retry, throttled progress and lyrics backfill. |
| 122 | DownloadManager.constructor | method | Captures the downloads store and host callbacks for offline, progress, completion and busy state. |
| 127 | DownloadManager.start | method | Requeues persisted jobs, publishes, pumps, then repairs credits and backfills lyrics. |
| 144 | DownloadManager.addTrack | method | Enqueues one track source, adds it to the in-memory queue and pumps. |
| 151 | DownloadManager.addCollection | method | Saves the collection snapshot, fans out track sources, caches the cover and pumps. |
| 170 | DownloadManager.removeTrack | method | Aborts any running job, drops queue state and removes the track, protecting the playing file. |
| 179 | DownloadManager.syncCollection | method | Forwards updated track ids to the store and publishes. |
| 184 | DownloadManager.pruneCollection | method | Applies store pruning, cancels affected jobs, removes their temp dirs and publishes. |
| 200 | DownloadManager.removeCollection | method | Removes a collection, cancels affected jobs and cleans their temp dirs. |
| 216 | DownloadManager.cancel | method | Drops a job from the queue, aborts it, deletes the job and its temp directory. |
| 225 | DownloadManager.retry | method | Resets a failed job to queued with zero attempts and pumps. |
| 234 | DownloadManager.clear | method | Aborts the active job, empties the queue and clears the store while sparing the playing track. |
| 252 | DownloadManager.onNetworkChange | method | Pauses all jobs when offline, otherwise requeues paused jobs and retries credit repair. |
| 268 | DownloadManager.snapshot | method | Delegates to the store snapshot, merging live progress into job views. |
| 272 | DownloadManager.shutdown | method | Clears timers, marks the active job paused and aborts it so no child starts during quit. |
| 288 | DownloadManager.enqueue | method | Private: appends an id to the queue when not already present. |
| 292 | DownloadManager.pauseAll | method | Empties the queue, marks queued/downloading jobs paused and aborts the active download. |
| 307 | DownloadManager.stop | method | Aborts the active child for a track, distinguishing pause from cancel. |
| 314 | DownloadManager.pump | method | Starts the next queued job when online, idle and not shutting down. |
| 345 | DownloadManager.run | method | Runs one yt-dlp download end to end: audio-first swap, space guard, progress, art, store.put and error classification. |
| 517 | DownloadManager.handleProgress | method | Parses a VIBY progress line, persists the estimate once, throttles onProgress to 250 ms. |
| 538 | DownloadManager.findDownload | method | Finds the finished non-`.part` file matching the safe id in the temp dir. |
| 551 | DownloadManager.cacheCollectionArt | method | Fetches and stores a collection cover, then publishes. |
| 562 | DownloadManager.artFor | method | Resolves a track cover from its own thumbnail or from an owning collection's art. |
| 581 | DownloadManager.repairCredits | method | Backfills missing album artist credits from the catalog and drops lyrics cached under bad credits. |
| 651 | DownloadManager.storeLyrics | method | Fetches and pins lyrics for a downloaded track; failures are swallowed. |
| 673 | DownloadManager.backfillLyrics | method | Tops up lyrics for existing downloads, skipping stored tracks and returning early when offline. |
| 687 | DownloadManager.publish | method | Recomputes busy state and debounces `onChanged` by 60 ms. |
| 696 | DownloadManager.updateBusy | method | Reports busy only while downloading or queued online, preventing a stuck power blocker. |
| 710 | DownloadManager.cancelCollection | method | Cancels a collection's remaining jobs, aborting the active one; completed entries survive. |
| 725 | DownloadManager.cleanTmp | method | Best-effort removal of a job's staging directory, tolerating Windows file locks. |
| 737 | DownloadManager.pause | method | Pauses one job at the user's request, keeping its partial file for resume. |
| 750 | DownloadManager.resume | method | Requeues a paused job and pumps the queue. |
| 759 | DownloadManager.pauseCollection | method | Pauses every remaining job owned by a collection. |
| 765 | DownloadManager.resumeCollection | method | Requeues a collection's paused jobs. |
| 786 | downloadIdFor | function | Picks the official audio id for a video/ugc row, falling back to the row's own id. |

#### src/main/downloads/store.ts

Persisted downloads index of entries, collections and jobs, with healing and orphan sweeping.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 49 | unique | function | Dedupes and drops falsy strings for sources and track ids. |
| 57 | DownloadsStore | class | Owns `index.json` plus audio, art, lyrics and tmp folders for downloads. |
| 67 | DownloadsStore.constructor | method | Creates folders, loads the index and flags recovery when the shape is corrupt. |
| 124 | DownloadsStore.dir | method | Getter for the downloads root directory. |
| 128 | DownloadsStore.audioDir | method | Getter for the `audio` folder holding downloaded files. |
| 132 | DownloadsStore.artDir | method | Getter for the content-addressed `art` folder. |
| 137 | DownloadsStore.lyricsDir | method | Getter for pinned lyrics stored with downloads. |
| 141 | DownloadsStore.tmpDir | method | Getter for per-job staging directories. |
| 145 | DownloadsStore.tmpDirFor | method | Per-track staging directory under `tmp`. |
| 150 | DownloadsStore.safeId | method | Sanitises a video id so it cannot escape the downloads folder. |
| 154 | DownloadsStore.lyricsPath | method | Path of the pinned lyrics JSON for a track. |
| 159 | DownloadsStore.lyrics | method | Reads and shape-checks pinned lyrics, returning null when absent or damaged. |
| 169 | DownloadsStore.putLyrics | method | Atomically writes lyrics for an existing entry via a unique temp file. |
| 185 | DownloadsStore.removeLyrics | method | Force-removes the lyrics file for a track. |
| 189 | DownloadsStore.lookup | method | Returns the audio path or heals away a stale entry when the file is gone. |
| 202 | DownloadsStore.extOf | method | Returns the recorded container extension for a track, or null. |
| 206 | DownloadsStore.entry | method | Decorated entry (art URL, copied arrays) for one track, or null. |
| 211 | DownloadsStore.has | method | True when lookup finds the audio file on disk. |
| 215 | DownloadsStore.entries | method | All entries decorated and sorted newest-first. |
| 221 | DownloadsStore.collections | method | All collections decorated and sorted newest-first. |
| 232 | DownloadsStore.patchTrack | method | Patches credits on an entry and its job, reporting whether anything changed. |
| 249 | DownloadsStore.collection | method | Decorated collection by key, or null. |
| 254 | DownloadsStore.job | method | Shallow copy of a job with fresh track and sources arrays. |
| 259 | DownloadsStore.allJobs | method | All jobs as `{id, job}` pairs with copied arrays. |
| 266 | DownloadsStore.jobViews | method | Renderer-facing job views, merged with supplied live progress. |
| 279 | DownloadsStore.snapshot | method | Builds a revisioned snapshot, incrementing the revision before awaiting stats. |
| 292 | DownloadsStore.bytes | method | Sum of indexed audio bytes. |
| 296 | DownloadsStore.freeBytes | method | Disk free space via statfs, returning null (unknown) rather than 0 on failure. |
| 307 | DownloadsStore.stats | method | Byte total, entry count, free space and root directory. |
| 317 | DownloadsStore.enqueue | method | Adds sources or queued jobs for missing tracks, returning ids that started jobs. |
| 358 | DownloadsStore.addCollection | method | Upserts a collection snapshot, keeping existing art and `addedAt`. |
| 374 | DownloadsStore.syncCollection | method | Replaces a collection's track ids after the playlist grew. |
| 382 | DownloadsStore.pruneCollection | method | Narrows a collection, unlinks unreferenced files/jobs and returns affected ids. |
| 418 | DownloadsStore.setCollectionArt | method | Stores the art path on a collection. |
| 425 | DownloadsStore.setJobState | method | Sets job state plus optional error and attempts. |
| 440 | DownloadsStore.setJobEstimate | method | Persists the last reported total so retries can guard disk space. |
| 447 | DownloadsStore.deleteJob | method | Removes a job record. |
| 454 | DownloadsStore.put | method | Moves the temp file in, snapshots the entry, drops the job and cleans tmp. |
| 498 | DownloadsStore.removeTrack | method | Removes an entry, job, collection references, files, art and lyrics. |
| 518 | DownloadsStore.removeCollection | method | Deletes a collection and every reference it owned, returning affected job ids. |
| 551 | DownloadsStore.clear | method | Clears the index, unlinks audio except the playing file and recreates empty dirs. |
| 589 | DownloadsStore.artNameFor | method | Relative `art/<sha1>.<ext>` name for a cover URL. |
| 593 | DownloadsStore.heal | method | Startup repair: drops missing files and art, restores covers, pauses stale jobs, sweeps orphans. |
| 666 | DownloadsStore.sweepArt | method | Unlinks art files that no entry or collection references. |
| 686 | DownloadsStore.sweepLyrics | method | Unlinks lyrics files whose entry is gone. |
| 699 | DownloadsStore.audioFiles | method | Private readdir of the audio folder. |
| 707 | DownloadsStore.artFiles | method | Private readdir of the art folder. |
| 715 | DownloadsStore.lyricsFiles | method | Private readdir of the lyrics folder. |
| 723 | DownloadsStore.tmpDirs | method | Private readdir of the tmp folder. |
| 732 | DownloadsStore.removeMissingEntry | method | Drops a stale entry and job without rewriting collection membership. |
| 743 | DownloadsStore.unlinkEntry | method | Deletes an entry's audio unless kept, and always its lyrics. |
| 755 | DownloadsStore.existingArt | method | Returns art only when the file exists under the downloads root. |
| 760 | DownloadsStore.artForEntry | method | Entry cover, else the cover of a collection containing the track. |
| 771 | DownloadsStore.decorateEntry | method | Copies the entry and adds an `artUrl` media URL. |
| 781 | DownloadsStore.decorateCollection | method | Copies the collection and adds an `artUrl` media URL. |
| 795 | DownloadsStore.cancelJobsForSource | method | Removes a collection source from jobs, deletes only unowned jobs, keeps completed entries and drops an empty collection. |
| 815 | DownloadsStore.setJobPause | method | Sets a job's paused/queued state and records whether the user asked. |

#### src/main/lyrics.ts

LRCLIB-first lyrics lookup with a lyrics.ovh fallback, cached on disk including misses.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 22 | lyricsStore | function | Lazily opens the userData `lyrics.json` JsonStore. |
| 37 | getLyrics | function | Returns cached lyrics or shares one in-flight request per track id. |
| 53 | loadLyrics | function | Looks lyrics up, persists the result including misses, and returns it. |
| 64 | cachedLyrics | function | Persisted lyrics without network, treating stale misses as absent. |
| 76 | forgetLyrics | function | Deletes a cached entry so repaired credits can be looked up again. |
| 84 | usableArtist | function | Strips placeholder credits and reduces to the primary artist. |
| 89 | lookup | function | Exact LRCLIB call, then search pick, then lyrics.ovh; throws when only transient failures occurred. |
| 132 | ovhLookup | function | Queries lyrics.ovh for plain text, reporting whether a failure was transient. |
| 158 | fetchOvhLyrics | function | Compatibility wrapper returning only the plain lyrics. |
| 164 | request | function | GETs an LRCLIB endpoint with bounded JSON, treating 400/404 as definitive misses. |
| 195 | toLyrics | function | Converts an LRCLIB record into instrumental, synced or plain Lyrics. |
| 214 | parseLrc | function | Parses `[mm:ss.xx]` timestamps, including multiple per line, into sorted lyric lines. |
| 233 | pickBest | function | Scores search results by title, artist, duration and sync availability, rejecting wrong songs. |
| 283 | comparisonText | function | NFKD-normalises text and strips feature markers for comparison. |
| 292 | primaryArtist | function | Splits only on explicit feat/ft/with, keeping names like "Tyler, The Creator" intact. |
| 305 | cleanTitle | function | Removes feat, remaster and version parentheticals from a title. |
| 313 | save | function | Stores lyrics with `fetchedAt` and trims the cache to 300 entries. |
| 325 | strip | function | Drops the internal `fetchedAt` field before returning Lyrics. |

#### src/main/innertube/client.ts

YouTube Music InnerTube client for search, browse, playlists, radio and home shelves.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 27 | context | function | Builds the WEB_REMIX client context, including the remembered visitor id. |
| 39 | rememberVisitor | function | Saves `responseContext.visitorData` so continuations keep the same visitor. |
| 47 | call | function | POSTs an InnerTube endpoint with merged timeout/abort and remembers the visitor. |
| 75 | search | function | Searches with an optional filter param and returns results ranked for search. |
| 86 | rankForSearch | function | Sorts official audio first, then songs, videos, uploads and non-song items. |
| 87 | weight | arrow | Score per item kind and video type used by `rankForSearch`. |
| 98 | normalizeTitle | function | Strips "(Official Video)"/"[4K]" noise so titles can be matched. |
| 116 | moodCategories | function | Fetches and session-caches the moods/genres navigation tiles. |
| 129 | artistImage | function | Resolves an artist portrait through artist search, caching up to 200 entries. |
| 158 | audioTrackFor | function | Finds the released audio track matching a video, caching results per video id. |
| 198 | itemKey | function | Builds the `kind:id` identity used to merge pages without duplicates. |
| 207 | discographyItems | function | Follows browse continuations to collect a full discography, capped at 100 pages. |
| 237 | expandDiscography | function | Replaces discography shelf previews by fetching each shelf's "More" page. |
| 273 | browse | function | Opens an album, artist or playlist: header, shelves, dedupe and all continuation pages. |
| 341 | playlistItems | function | Follows playlist continuations, returning items plus the page header. |
| 378 | radio | function | Builds the "Up next" queue from the `next` endpoint, filtering out videos and uploads. |
| 398 | home | function | Fetches home browse shelves for moods, charts and recommendations. |

#### src/main/innertube/constants.ts

Static WEB_REMIX client identity and the base64 search-filter parameter tables.

| Line | Symbol | Kind | Role |
|---:|---|---|---|

#### src/main/innertube/parse.ts

Pure, tolerant walkers that turn InnerTube JSON into catalog items, shelves and headers.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 25 | releaseTypeOf | function | Reads Album/Single/EP/Compilation/Audiobook from a release subtitle line. |
| 31 | isSeparator | function | True for punctuation-only subtitle runs that carry no link. |
| 38 | extractItems | function | Walks the response for recognised renderers and dedupes by kind, id and title. |
| 61 | dedupeTracks | function | Drops repeated song ids and video/upload rows that duplicate an audio title. |
| 87 | continuationToken | function | Finds the first continuation token anywhere in a browse response. |
| 90 | visit | arrow | Recursive helper inside `continuationToken` that stops at the first token. |
| 116 | extractShelves | function | Collects carousel, shelf and card shelves, keeping only non-empty ones. |
| 126 | extractMoodCategories | function | Collects navigation-button tiles as mood and genre categories. |
| 130 | walk | arrow | Recursive helper inside `extractMoodCategories` matching navigation button renderers. |
| 168 | extractHeader | function | Builds a page header with title, art, artist, release type and listener count. |
| 220 | findByKey | function | Depth-limited recursive lookup of the first node holding a renderer key. |
| 241 | collectShelves | function | Recursive collector for the three shelf renderer shapes. |
| 292 | shelfMore | function | Extracts a shelf header's "More" browse target and page type. |
| 304 | walk | function | Recursive item collector dispatching on the three item renderer shapes. |
| 336 | fromResponsiveListItem | function | Parses a list row: ids, kind, subtitle parts, duration, views and thumbnail. |
| 428 | fromTwoRowItem | function | Parses a carousel card, reading watch or browse endpoints. |
| 468 | fromPlaylistPanelVideo | function | Parses a radio queue entry, keeping artist links and dropping counters. |
| 508 | refId | function | Returns an artist or album browse id, falling back to the UC/MPREb_ prefix. |
| 526 | partsFrom | function | Converts subtitle runs into parts carrying artist and album ids. |
| 548 | videoTypeOf | function | Maps `MUSIC_VIDEO_TYPE_*` to audio, video, ugc or undefined. |
| 567 | textOf | function | Reads `simpleText` or joins runs into a plain string. |
| 574 | runsOf | function | Returns a node's runs array, or an empty array. |
| 578 | bestThumbnail | function | Picks the largest thumbnail and rewrites its size to w360-h360. |
| 594 | parseDuration | function | Converts `mm:ss` or `h:mm:ss` text to seconds, or undefined. |
| 603 | pageTypeOf | function | Reads the browse page type from either endpoint shape. |
| 617 | kindFromSubtitle | function | Infers album, playlist or artist from the subtitle prefix. |
| 638 | kindFromPageType | function | Maps `MUSIC_PAGE_TYPE_*` values to catalog kinds. |

#### src/main/ytdlp/binary.ts

Provisions the yt-dlp runner (bundled CPython zipapp, system Python, frozen binary) and updates it.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 69 | binDir | function | userData `bin` directory holding managed runner files. |
| 73 | resourcesBinDir | function | Packaged or development resources `bin` directory. |
| 79 | pluginsDir | function | yt-dlp plugin directory used for PO-token providers. |
| 85 | managedBinaryPath | function | Path of the managed frozen binary. |
| 89 | managedZipappPath | function | Path of the managed zipapp. |
| 99 | ensureRunner | function | Memoises provisioning per launch and resets it after a failure. |
| 109 | provision | function | Tries bundled/system Python with the extracted zipapp, then the zipapp, then the binary. |
| 170 | bundledPython | function | Locates and validates the vendored interpreter for this OS and arch. |
| 186 | ensureExtracted | function | Unpacks the zipapp once into `yt-dlp-src` so `__pycache__` speeds later starts. |
| 209 | ensureZipapp | function | Returns a usable zipapp, copying the bundled copy or downloading the release asset. |
| 230 | markerPath | function | Path of the bundle comparison marker file. |
| 234 | readMarker | function | Reads the marker JSON, tolerating missing or corrupt files. |
| 248 | writeMarker | function | Writes the marker, ignoring write failures. |
| 256 | scriptVersion | function | Runs `<python> <script> --version` and returns the version token. |
| 267 | extractedVersion | function | Reads `__version__` from the extracted source without spawning a process. |
| 281 | shouldReplaceZipapp | function | Upgrade-only rule: replace when no current copy or the bundle is newer. |
| 295 | syncBundledZipapp | function | Copies a newer shipped zipapp into userData and drops the stale extraction. |
| 336 | ensureBinaryFile | function | Returns or installs the frozen binary, copying bundled or downloading the release asset. |
| 357 | download | function | Streams a release asset to a `.download` temp file with a 250 MB cap, then renames. |
| 372 | transform | method | Stream transform accumulating bytes and aborting once the size cap is exceeded. |
| 396 | makeExecutable | function | Applies chmod 755 on non-Windows platforms. |
| 401 | works | function | Probe that the runner executes and prints a date-stamped version. |
| 414 | findPython | function | Finds a usable Python on PATH, skipping Windows Store shims, plus macOS fallbacks. |
| 449 | isExecutable | function | Checks execute access and that the path is a regular file. |
| 459 | pluginArgs | function | Returns `--plugin-dirs` only when the plugin directory exists. |
| 467 | runnerInfo | function | Runs `--version` once, caches it, and reports path, kind and runtime. |
| 487 | updateRunner | function | Re-downloads the zipapp (re-unpacking) or runs `-U`, then refreshes the cached version. |

#### src/main/ytdlp/exec.ts

The single place that spawns yt-dlp children, enforcing timeouts, aborts and cleanup.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 24 | run | function | Spawns a child, buffers stdout/stderr, honours timeout and abort, resolves a `RunResult`. |
| 45 | onAbort | arrow | Kills the child when the caller's signal aborts. |
| 57 | finish | arrow | Settles once, clearing the timeout and the abort listener. |
| 78 | runStreamed | function | Streaming variant that emits complete stdout lines so progress reaches the UI early. |
| 93 | emitLines | arrow | Splits the buffer on newlines, forwarding non-empty lines; flushes the tail on finish. |
| 107 | onAbort | arrow | Kills the child when the caller's signal aborts. |
| 122 | finish | arrow | Settles once, clears timer and listener, then flushes any trailing line. |

#### src/main/ytdlp/resolver.ts

Resolves yt-dlp metadata into playable stream URLs with a TTL'd URL cache and capped children.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 30 | Resolver | class | Resolves tracks to stream URLs, caches them for two hours and caps concurrent children. |
| 39 | Resolver.hasCached | method | Cheap warm-cache check used to skip prefetching. |
| 44 | Resolver.cacheKey | method | Appends the bitrate cap to the normalized URL. |
| 49 | Resolver.clearUrlCache | method | Drops all cached stream URLs and persists the empty cache. |
| 59 | Resolver.attachUrlCache | method | Loads unexpired entries from disk and schedules a persist when memory already has entries. |
| 76 | Resolver.persistSoon | method | Debounces a cache write by 800 ms. |
| 84 | Resolver.persistNow | method | Prunes expired and overflow entries, then atomically writes the cache file. |
| 110 | Resolver.normalizeInput | method | Static: turns a bare 11-character video id into a watch URL. |
| 119 | Resolver.extractId | method | Static: best-effort 11-character video id from an id or URL. |
| 134 | Resolver.resolve | method | Validates input, serves cache hits, then inspects through yt-dlp under the play semaphore. |
| 181 | Resolver.inspect | method | Runs `-J` extraction, rejecting null or non-JSON output with a described error. |
| 225 | Resolver.download | method | Downloads audio into a temp dir under the play or background semaphore, cleaning up on failure. |
| 272 | Resolver.invalidate | method | Removes cached URLs for an input across all quality variants. |
| 311 | NoDirectUrlError | class | Signals SABR/DASH-only results while carrying the track for download-to-cache. |
| 312 | NoDirectUrlError.constructor | method | Sets the `no-direct-url` message and name, storing the track. |
| 326 | parseInfo | function | Picks the best progressive audio under the cap, else throws `NoDirectUrlError`. |
| 364 | parseTrack | function | Maps yt-dlp metadata to a Track, filling title, artist and duration fallbacks. |
| 376 | toStream | function | Builds a remote `StreamInfo` with mime, bitrate and expiry. |
| 388 | mimeFor | function | Maps a container extension to a MIME type. |
| 403 | firstLine | function | Returns the last non-empty stderr line for download failures. |
| 411 | isSafeYtDlpInput | function | Accepts bare video ids and http(s) URLs so renderer strings cannot become options. |
| 422 | ResolveError | class | Typed resolution failure carrying a kind and a human-readable message. |
| 423 | ResolveError.constructor | method | Stores the kind and sets the error name. |
| 436 | describeFailure | function | Maps yt-dlp stderr to botcheck, unavailable or unknown `ResolveError`s. |
| 468 | lastErrorLine | function | Returns the last `ERROR:` line from stderr without its prefix. |
| 477 | isInfo | function | Type guard requiring an object with a string `id`. |
| 482 | isPlaylistOnlyUrl | function | True for `list=`-only URLs, which are imports rather than songs. |
| 487 | Semaphore | class | Counting semaphore that caps concurrent yt-dlp children. |
| 491 | Semaphore.constructor | method | Records the concurrency limit. |
| 493 | Semaphore.run | method | Waits for a slot, runs the task, then releases the next waiter. |

### 12.3 Main process — imports, updates and Discord

Scope: `src/main/import/**`, updater/version/release-feed/update-manifest/update-key files, `src/main/discord/**`.
Kinds: `function` (declaration), `method` (class/object method, constructor, getter), `class`, `arrow` (named local arrow/function expression).
Constructors and the `isReady` getter are included explicitly (the reference extractor skips accessors and constructors).

#### src/main/import/apple.ts
Apple Music playlist scraper: reads the embedded `serialized-server-data` JSON from the public playlist page.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 32 | meta | function | Extracts a `<meta property|name=... content=...>` value from HTML in either attribute order. |
| 38 | albumOf | function | Derives the album name from the first tertiary link, stripping trailing " - Single/EP". |
| 43 | toTrack | function | Normalises one Apple lockup into `ImportTrack`, discarding non-song entries. |
| 60 | resolveApple | function | Fetches the playlist page, parses sections, and returns the `ImportSource` with header metadata. |

#### src/main/import/deezer.ts
Deezer playlist resolver over the public REST API, with paging past the inline track list.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 31 | toTrack | function | Maps a Deezer track object to `ImportTrack` with ids, duration and streamability. |
| 44 | resolveDeezer | function | Loads the playlist, pages `/tracks` until `nb_tracks` or 10k, and reports truncation. |

#### src/main/import/detect.ts
Service detection for pasted playlist links, including manual short-link redirect following.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 32 | followRedirect | function | Follows up to 6 manual redirects, re-validating each hop as public HTTP(S). |
| 68 | spotify | function | Matches open/play.spotify.com playlist URLs, throwing for album/track links. |
| 86 | apple | function | Matches music.apple.com playlist URLs and rejects album links. |
| 98 | deezer | function | Matches deezer.com `/playlist/<id>` URLs, rejecting album/track links. |
| 111 | youtube | function | Requires a YouTube `list` param and rejects radio/private list ids. |
| 136 | soundcloud | function | Requires a SoundCloud `/sets/` URL, rejecting single tracks. |
| 150 | detectImportUrl | function | Entry point: handles spotify: URIs, short links (once, depth-limited) and host adapters. |

#### src/main/import/errors.ts
Single user-facing error type for the whole import pipeline.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 2 | ImportError | class | Error subclass whose message is shown verbatim on the Import page. |
| 3 | ImportError.constructor | method | Sets the message and `name = 'ImportError'`. |

#### src/main/import/http.ts
Guarded HTTP helpers: SSRF checks, retries, bounded bodies, JSON/text wrappers.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 13 | sleep | function | Promise-based delay used by retry and paging back-off. |
| 29 | assertPublicHttpUrl | function | Resolves the host and throws `ImportError` for private, local or unresolvable targets. |
| 53 | httpGet | function | Retries up to 3 times on 408/425/429/5xx with back-off and per-request timeout. |
| 88 | fetchGuarded | function | Re-validates every redirect hop (max 5) before fetching; used by `httpGet`. |
| 126 | getText | function | GETs and reads a size-bounded text body, mapping oversize/HTTP errors to `ImportError`. |
| 139 | getJson | function | GETs and parses bounded JSON, mapping failures to `ImportError`. |

#### src/main/import/index.ts
Public façade that detects the service then dispatches to the matching adapter.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | resolveImport | function | Detects the link and delegates to the Spotify/Deezer/YouTube/Apple/SoundCloud resolver. |

#### src/main/import/matcher.ts
Fuzzy title/artist/duration matching against YouTube Music search, run with 3 workers.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 23 | normalize | function | Lowercases, strips diacritics, featuring/edition noise, punctuation and years. |
| 41 | cleanArtist | function | Normalises an artist name and drops a leading "the". |
| 45 | versions | function | Lists version keywords (live, remix, sped up, ...) present in a title. |
| 50 | tokens | function | Splits normalised text into a token set. |
| 54 | jaccard | function | Token-set Jaccard similarity, 0 when either set is empty. |
| 61 | bigrams | function | Builds the character-bigram set for a string. |
| 67 | dice | function | Character-bigram Dice coefficient used by `similarity`. |
| 74 | similarity | function | Blends token and bigram scores into a 0-1 string similarity. |
| 82 | candidateArtists | function | Picks artist names from `artists`, linked parts, or the subtitle prefix. |
| 89 | artistSimilarity | function | Best match score across the two leading source artists vs. candidates. |
| 105 | durationSimilarity | function | Buckets absolute duration delta into 1/0.8/0.5/0.2/0 scores. |
| 126 | scoreCandidate | function | Combines title/artist/duration weights, version and video-type penalties, sets auto/review. |
| 165 | toTrack | function | Converts a `CatalogItem` into a `Track`, resolving credits and YouTube URL. |
| 192 | sourceTrack | function | Converts an existing YouTube import track into a `Track` without searching. |
| 208 | primaryArtist | function | Takes the first artist and splits off "&", ",", "feat", "ft", "with". |
| 212 | queryFor | function | Builds a <=120-char normalised "title artist" search query. |
| 223 | matchImport | function | Scores search results per track with 3 workers, caching queries and reporting progress. |
| 236 | report | arrow | Emits progress every 5 completed tracks or on completion. |
| 240 | searchCached | arrow | Memoises `searchFn` results by lowercased query. |
| 249 | worker | arrow | Pulls track indexes from a cursor, scores candidates, records auto/review/missing results. |

#### src/main/import/soundcloud.ts
SoundCloud set resolver with a cached scraped `client_id` and a single refresh retry.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | discoverClientId | function | Scrapes sndcdn asset bundles for a `client_id`, caching it for 6 hours. |
| 51 | toTrack | function | Maps a SoundCloud track object to `ImportTrack`, skipping non-track entries. |
| 63 | resolveSoundcloud | function | Resolves the set URL, retries once on 401/403 with a fresh client id, returns source. |

#### src/main/import/spotify.ts
Keyless Spotify playlist reader: embed bootstrap token plus a paginated GraphQL `fetchPlaylist` query, with embed fallback.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | SpotifyImportError | class | Import-specific error subclass used by every Spotify failure path. |
| 30 | SpotifyImportError.constructor | method | Sets the message and `name = 'SpotifyImportError'`. |
| 80 | timeoutSignal | function | Combines the caller signal with a 15s timeout signal. |
| 85 | get | function | Fetches a page with the browser UA/accept headers and the timeout signal. |
| 96 | parsePlaylistId | function | Accepts a raw id, `spotify:playlist:` URI or open/play Spotify URL; throws otherwise. |
| 119 | parseNextData | function | Extracts and JSON-parses the `__NEXT_DATA__` script, throwing `SpotifyImportError`. |
| 129 | bootstrap | function | Fetches the embed page and returns its entity plus anonymous access token/expiry. |
| 164 | bestCover | function | Picks the widest cover-art source URL. |
| 171 | embedTrack | function | Maps an embed track row to `ImportTrack` (fallback path). |
| 189 | normaliseTrack | function | Maps a Pathfinder track to `ImportTrack`, skipping non-audio/non-Track entries. |
| 213 | fetchPage | function | Calls the persisted-query GraphQL endpoint for one 100-track page, mapping 401/403/429 errors. |
| 294 | resolveSpotifyPlaylist | function | Paginates with token refresh, falls back to embed tracks, and returns the `ImportSource`. |

#### src/main/import/youtube.ts
YouTube Music playlist import that reuses the catalog client's parsed rows.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 11 | resolveYoutube | function | Rejects radio/private ids, follows continuations via `playlistItems`, and normalises tracks. |

#### src/main/release-feed.ts
Public GitHub release feed used by macOS updates, including signed-manifest verification.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 32 | fetchLatestRelease | function | Fetches `/releases/latest`, then requires and verifies the signed manifest (fails closed). |
| 63 | releaseFromGithub | function | Pure mapping of the API JSON to `ReleaseInfo`, selecting the arch DMG and sha256 digest. |
| 93 | fetchJson | function | GETs bounded JSON from GitHub with a 10s timeout and user-facing error mapping. |

#### src/main/update-key.ts
Pinned Ed25519 public key (base64 SPKI) for the signed update manifest. No function, method, or class symbols; exports a single constant.

#### src/main/update-manifest.ts
Canonical signing payload plus Ed25519 verification of `update-manifest.json`.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 16 | manifestPayload | function | Builds the exact `version\nname sha256\n...` bytes that get signed. |
| 28 | verifyManifest | function | Validates shape/digests, verifies the signature, and returns `{version, files}` or null. |

#### src/main/updater.ts
Platform-independent update state machine driven by injected native/manual adapters.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 5 | UpdateIntegrityError | class | Marks signature/digest failures that must block installation. |
| 62 | Updater | class | Holds update phase, release info and abort controller; broadcasts state via `onState`. |
| 67 | Updater.constructor | method | Seeds the idle state with current version and `canInstall`. |
| 75 | Updater.get | function | Returns the current `UpdateState`. |
| 79 | Updater.check | function | Checks for updates (native or release feed), enforcing signed-manifest presence and skip rules. |
| 147 | Updater.download | function | Downloads via native or manual adapter with clamped progress; handles cancel/errors. |
| 210 | Updater.downloadAndInstall | function | Downloads then defers `install()` by a tick when the state reaches `ready`. |
| 221 | Updater.cancel | function | Aborts the active download controller. |
| 226 | Updater.install | function | Quits (manual macOS) or calls the native installer when state is `ready`. |
| 238 | Updater.skippedState | function | Publishes an up-to-date state noting the version is skipped. |
| 248 | Updater.set | function | Merges a patch into state, notifies `onState`, and returns the new state. |
| 254 | Updater.fail | function | Publishes an error phase with a cleared progress value. |
| 259 | clamp | function | Clamps a progress fraction into 0..1, mapping non-finite to 0. |
| 265 | messageFor | function | Reduces an unknown error to its first non-empty line for display. |

#### src/main/updater-native.ts
Windows adapter over electron-updater/NSIS: check, hash-verified download, silent install.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 21 | createNativeUpdater | function | Configures `autoUpdater` (no auto-download, no web installer) and returns the `NativeUpdater`. |
| 31 | check | method | Runs `checkForUpdates` and returns the newer version string, or null. |
| 38 | download | method | Wraps `downloadUpdate` with stall timeout, abort wiring, progress and sha256 verification. |
| 50 | arm | arrow | Resets the 120s stall timer before cancelling the download token. |
| 58 | cleanup | arrow | Clears the stall timer and detaches abort/progress/downloaded/error listeners. |
| 65 | handleAbort | arrow | Cancels the electron-updater token when the caller aborts. |
| 66 | handleProgress | arrow | Re-arms the stall timer and forwards percent/100 to the caller. |
| 70 | handleDownloaded | arrow | Hashes the file, resolves on match, deletes and rejects on mismatch. |
| 84 | handleError | arrow | Cleans up listeners and rejects the download promise. |
| 101 | install | method | Marks quitting then calls `quitAndInstall(true, true)` for a silent relaunch. |
| 114 | sha256File | function | Streams a file and resolves its hex sha256 digest. |
| 128 | createLogger | function | Builds an electron-updater logger that appends to `updater.log`. |
| 134 | line | arrow | Appends one timestamped line to the log file, swallowing all logging errors. |

#### src/main/updater-manual.ts
macOS manual update path: downloads and verifies the DMG, opens it, and returns a user note.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 22 | downloadMacInstaller | function | Validates the manifest entry, downloads to a versioned filename, verifies and opens it. |
| 60 | download | function | Streams the installer to disk with stall/abort handling, hashing and progress. |
| 68 | forwardAbort | arrow | Aborts the internal controller when the caller signal fires. |
| 72 | arm | arrow | Resets the 60s stall timer on each received chunk. |
| 118 | installerName | function | Takes the last URL segment as the filename, defaulting to `Viby.dmg`. |
| 124 | inApplications | function | Reports whether the running app lives in /Applications. |

#### src/main/version.ts
Thin re-export of `@shared/version` so updater imports stay unchanged. No function, method, or class symbols; re-export only.

#### src/main/discord/activity.ts
Pure builder for the Discord Rich Presence activity payload from a presence snapshot.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 41 | text | function | Trims and length-caps a string, returning undefined when empty/shorter than `min`. |
| 49 | link | function | Validates an http(s) URL against the length limit without truncating. |
| 56 | imageLink | function | Validates an https image URL against Discord's 313-char cap. |
| 68 | artworkUrl | function | Uses the track thumbnail or a derived i.ytimg fallback for an 11-char video id. |
| 81 | buildActivity | function | Projects playback position into timestamps and builds details/state/assets/buttons; null when paused. |

#### src/main/discord/client.ts
One local Discord IPC socket: framing, handshake, request/nonce matching and cleanup.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 27 | isRecord | function | Type guard for non-null objects. |
| 31 | errorMessage | function | Pulls a message from either the top level or nested `data.message`. |
| 42 | DiscordIpcClient | class | Owns the socket, decoder, pending request map and ready handshake state. |
| 52 | DiscordIpcClient.constructor | method | Stores options and defaults the pid to `process.pid`. |
| 56 | DiscordIpcClient.isReady | method | Getter: true when ready and the socket is live. |
| 61 | DiscordIpcClient.onClose | method | Registers the drop handler used by `DiscordPresence` to retry. |
| 65 | DiscordIpcClient.open | method | Tries each candidate socket path in order, throwing the last error. |
| 79 | DiscordIpcClient.setActivity | method | Sends `SET_ACTIVITY` with a nonce and rejects after a 5s response timeout. |
| 107 | DiscordIpcClient.close | method | Sends a close frame, fails pending waits, rejects all in-flight requests. |
| 122 | DiscordIpcClient.openAt | method | Connects to one pipe with a 1s timeout, then attaches data/close and handshakes. |
| 145 | cleanup | arrow | Removes the connect/error listeners and clears the connect timer. |
| 150 | onConnect | arrow | Cleans up listeners and resolves the connection promise. |
| 154 | onError | arrow | Destroys the socket, cleans up listeners and rejects. |
| 182 | DiscordIpcClient.handshake | method | Sends opcode 0 with the client id and waits up to 5s for READY. |
| 207 | DiscordIpcClient.handleData | method | Decodes frames, answers pings, and routes frame opcodes to `handleMessage`. |
| 235 | DiscordIpcClient.handleMessage | method | Resolves READY waits, rejects ERROR payloads by nonce, resolves matching responses. |
| 259 | DiscordIpcClient.handleClose | method | Ignores stale sockets; clears state, rejects pending work and calls the close handler. |
| 270 | DiscordIpcClient.failReadyWait | method | Rejects and clears the pending handshake wait. |
| 277 | DiscordIpcClient.resolvePending | method | Clears the nonce timer, deletes the entry and resolves it. |
| 285 | DiscordIpcClient.rejectPending | method | Clears the nonce timer, deletes the entry and rejects it. |
| 293 | DiscordIpcClient.rejectAll | method | Rejects and clears every in-flight request. |

#### src/main/discord/frame.ts
Wire format for Discord's local RPC: u32 opcode + u32 length + JSON payload.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 19 | encodeFrame | function | Serialises JSON and prefixes the 8-byte little-endian header. |
| 31 | FrameDecoder | class | Buffers partial socket chunks and yields complete frames. |
| 34 | FrameDecoder.push | method | Accumulates a chunk, emits decoded frames, throws on oversized length, drops bad JSON. |

#### src/main/discord/index.ts
Module singleton that wires settings/presence calls to one `DiscordPresence` instance.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 11 | socketPaths | function | Returns the dev `VIBY_DISCORD_IPC` override or the platform socket paths. |
| 17 | badgeUrl | function | Returns the dev `VIBY_DISCORD_BADGE_URL` override when unpackaged. |
| 22 | initDiscord | function | Lazily creates the presence instance and applies the enabled flag. |
| 33 | setDiscordEnabled | function | Forwards a settings toggle to the presence instance. |
| 37 | updateDiscordPresence | function | Forwards a renderer playback snapshot to the presence instance. |
| 41 | stopDiscord | function | Stops presence and drops the singleton reference. |

#### src/main/discord/paths.ts
Enumerates candidate Discord IPC socket paths for the current platform.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | discordIpcPaths | function | Returns pipes discord-ipc-0..9 on Windows, else deduped paths under runtime/temp dirs. |

#### src/main/discord/presence.ts
Connection manager: coalesces snapshots, throttles sends, retries with back-off.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 36 | DiscordPresence | class | Holds the client, latest snapshot, retry state and rate limiter. |
| 48 | DiscordPresence.constructor | method | Resolves the clock and constructs the 5-per-20s rate limiter. |
| 57 | DiscordPresence.setEnabled | method | Enabling connects immediately; disabling shuts down the client and timers. |
| 68 | DiscordPresence.update | method | Stores the newest valid snapshot and schedules a send. |
| 76 | DiscordPresence.stop | method | Disables presence and tears down the connection. |
| 81 | DiscordPresence.connect | method | Creates/opens a client (injectable factory) and resets retry/limit state on success. |
| 114 | DiscordPresence.handleClose | method | Drops the client and schedules a retry when still enabled. |
| 123 | DiscordPresence.scheduleRetry | method | Schedules a reconnect using escalating delays (30s..5m). |
| 135 | DiscordPresence.schedule | method | Waits for the coalescing window or limiter, then flushes the latest snapshot. |
| 151 | DiscordPresence.flush | method | Builds the activity, skips duplicates, records the send and handles failures. |
| 173 | DiscordPresence.shutdown | method | Clears timers, resets state/limiter and closes the client. |

#### src/main/discord/rate-limit.ts
Sliding-window limiter for Discord's activity update cap.
| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 7 | UpdateRateLimiter | class | Tracks send timestamps within a window. |
| 10 | UpdateRateLimiter.constructor | method | Stores limit, window and clock (defaults 5 / 20s / Date.now). |
| 17 | UpdateRateLimiter.delay | method | Returns 0 under the cap, or ms until the oldest send leaves the window. |
| 24 | UpdateRateLimiter.record | method | Prunes the window and records a send timestamp. |
| 30 | UpdateRateLimiter.reset | method | Clears all recorded timestamps. |
| 34 | UpdateRateLimiter.prune | method | Drops timestamps older than the window. |

### 12.4 Renderer — stores and helpers

Scope: every `.ts` file under `src/renderer/lib/` (32 files). Getters are listed as methods because they are callable class members the AST extractor skips; anonymous event/IPC callbacks are omitted.

#### src/renderer/lib/album.ts
Navigation helper that opens an album page even when the caller has no browse id.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | openAlbum | function | Navigates straight to the album when an id exists, else resolves with artist context. |
| 27 | lookup | function | Requires the release title and credited artist to match; otherwise shows album search results. |

#### src/renderer/lib/api.ts
Single access point for the preload bridge exposed on `window.viby`.

| Line | Symbol | Kind | Role |
|---:|---|---|---|

No functions or methods: this module only exports the `api` bridge constant.

#### src/renderer/lib/artist.ts
Opens artist pages from links that may arrive without a browse id.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | openArtist | function | Navigates directly when given an id, otherwise resolves the full name asynchronously. |
| 22 | lookup | function | Opens only an exact artist-name match; otherwise shows artist search results, never a guess. |

#### src/renderer/lib/artwork.svelte.ts
Renderer-side artwork cache that swaps remote URLs for local `viby-media://` copies.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 3 | isRemote | function | Returns true when a URL uses the http or https scheme. |
| 15 | ArtworkStore | class | Tracks resolved, pending and failed image URLs behind a generation guard. |
| 26 | ArtworkStore.src | method | Returns cached local art, otherwise queues a warm and returns the remote URL. |
| 39 | ArtworkStore.warm | method | Queues every remote URL a surface will show, optionally clearing prior failures. |
| 48 | ArtworkStore.retry | method | Re-queues images that failed while offline, typically after reconnect. |
| 59 | ArtworkStore.forget | method | Bumps the generation and drops all mappings after the disk cache is cleared. |
| 72 | ArtworkStore.broken | method | Drops the mapping for a failed local URL and re-queues its remote source. |
| 87 | ArtworkStore.enqueue | method | Adds a URL unless known, pending or failed, then starts a flush. |
| 94 | ArtworkStore.flush | method | Caches pending URLs in batches of eight and discards results from an older generation. |

#### src/renderer/lib/catalog-cache.svelte.ts
Ten-minute caches for catalog detail pages, radio queues and home shelf state.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | ShelfState | class | Holds shelf list, loading/error flags and an attempted guard for Home. |
| 22 | cachedDetail | function | Returns a non-expired browse result, deleting the entry when stale. |
| 32 | cacheDetail | function | Stores a browse result and evicts the oldest beyond 40 entries. |
| 44 | cachedRadio | function | Returns the cached radio queue for a seed track, or null. |
| 48 | cacheRadio | function | Stores a seed's radio queue and evicts the oldest beyond 12 seeds. |

#### src/renderer/lib/changelog.svelte.ts
What's New sheet state, comparing the running version with the last-shown notes.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 16 | ChangelogStore | class | Holds the open flag, unseen entries and the running version. |
| 29 | ChangelogStore.init | method | Refreshes changelog state during app startup. |
| 34 | ChangelogStore.refresh | method | Loads notes and settings, records first-run baselines and arms the open timer. |
| 88 | ChangelogStore.showCurrent | method | Reopens the running version's notes from Settings and marks them seen. |
| 107 | ChangelogStore.dismiss | method | Closes the sheet, clears entries and persists last-seen/shown versions. |
| 124 | ChangelogStore.clearTimer | method | Cancels and nulls the pending open timer. |

#### src/renderer/lib/download-groups.ts
Pure helpers that split downloads into collections and loose songs.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 11 | entryArt | function | Resolves entry art from the entry, its owning collection, or the track thumbnail. |
| 20 | entryToItem | function | Converts a download entry into a catalog item with resolved artwork. |
| 25 | collectionEntries | function | Returns a collection's downloaded entries in its `trackIds` order. |
| 35 | collectionItems | function | Maps collection entries to catalog items, preferring collection artwork. |
| 48 | collectionOwnedIds | function | Collects track ids owned by any downloaded collection. |
| 61 | standaloneEntries | function | Filters out entries already owned by a downloaded collection. |
| 69 | collectionBytes | function | Sums the byte size of a collection's downloaded entries. |
| 76 | formatSize | function | Formats bytes as GB or whole MB, with an em dash for missing values. |

#### src/renderer/lib/download-jobs.ts
Groups pending download jobs into album/playlist/liked collections and loose songs.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | collectionSource | function | Picks the first album, playlist or liked source from a job. |
| 38 | groupState | function | Returns the dominant job state: downloading, queued, paused or failed. |
| 50 | groupDownloadJobs | function | Groups live jobs by collection, orders them, and computes coverage and percent. |

#### src/renderer/lib/downloads.svelte.ts
Renderer mirror of the main-process download index and job progress.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 28 | DownloadsStore | class | Holds the snapshot, per-track jobs, loading and error state. |
| 37 | DownloadsStore.entries | method | Returns downloaded entries, or an empty list before the first snapshot. |
| 41 | DownloadsStore.collections | method | Returns downloaded collections, or an empty list. |
| 45 | DownloadsStore.stats | method | Returns aggregate download stats, or null. |
| 49 | DownloadsStore.init | method | Subscribes to change/progress events once, then reloads the snapshot. |
| 57 | DownloadsStore.reload | method | Fetches the authoritative snapshot, toggling loading and error state. |
| 69 | DownloadsStore.mutate | method | Runs a mutation, applies its snapshot, and reloads after a failure. |
| 81 | DownloadsStore.entryFor | method | Finds the download entry for a track id, or null. |
| 85 | DownloadsStore.downloaded | method | Reports whether a track id exists in the download index. |
| 89 | DownloadsStore.jobFor | method | Returns the active job view for a track, or null. |
| 93 | DownloadsStore.stateFor | method | Resolves a track's UI state from job state or downloaded status. |
| 104 | DownloadsStore.countsFor | method | Counts done/active/paused/failed tracks, scoping pending states to one collection when given. |
| 120 | DownloadsStore.addTrack | method | Sends a plain track copy to the download queue. |
| 124 | DownloadsStore.addCollection | method | Queues a collection with plain copies of its tracks. |
| 128 | DownloadsStore.removeTrack | method | Pauses playback if needed, then removes a downloaded track. |
| 133 | DownloadsStore.removeCollection | method | Pauses playback of the collection's tracks, then deletes them. |
| 139 | DownloadsStore.pruneCollection | method | Keeps only the given track ids and pauses removed ones if playing. |
| 148 | DownloadsStore.clear | method | Pauses the playing download, then clears the whole download index. |
| 153 | DownloadsStore.retry | method | Retries a failed download job. |
| 157 | DownloadsStore.cancel | method | Cancels an in-flight download job. |
| 161 | DownloadsStore.apply | method | Ignores stale revisions and stores the snapshot plus job map. |
| 175 | DownloadsStore.pauseIfPlaying | method | Toggles playback off when the current track is about to be deleted. |
| 184 | DownloadsStore.progress | method | Patches one job from a progress event, or reloads when the job is unknown. |
| 197 | DownloadsStore.pendingCount | method | Number of pending download jobs, used by the titlebar trigger and panel header. |
| 201 | DownloadsStore.cancelCollection | method | Cancels the remaining jobs for a collection through IPC. |
| 205 | DownloadsStore.pause | method | Pauses one download. |
| 209 | DownloadsStore.resume | method | Resumes one paused download. |
| 213 | DownloadsStore.pauseCollection | method | Pauses a collection's remaining jobs. |
| 217 | DownloadsStore.resumeCollection | method | Resumes a collection's paused jobs. |

#### src/renderer/lib/entity-lookup.ts

Verified matching for name-only artist and release links.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | normalizeEntityName | function | Accent-, case- and punctuation-insensitive identity text. |
| 47 | pickArtist | function | Returns only an exact artist-name match, or null. |
| 62 | pickAlbum | function | Matches a release by title and credited artist; refuses to guess without both. |
| 88 | primaryArtistName | function | First credited artist of a track, skipping page-type tags. |

#### src/renderer/lib/entity-search.ts

Safe destination for an unverified entity link: the matching search results.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | showEntitySearch | function | Navigates to search with the entity filter and the clicked name. |

#### src/renderer/lib/favorites.svelte.ts
Liked-song ids mirrored in the renderer for every heart control.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | Favorites | class | Holds the liked id set plus load guards. |
| 15 | Favorites.has | method | Checks whether a track id is liked. |
| 19 | Favorites.load | method | Loads liked ids once unless forced, guarding concurrent calls. |
| 31 | Favorites.toggle | method | Toggles a track's liked state via IPC and replaces the id set. |

#### src/renderer/lib/format.ts
Shared duration formatting for rows, cards and the player.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 2 | formatDuration | function | Formats seconds as m:ss or h:mm:ss, returning a fallback for invalid input. |

#### src/renderer/lib/history.svelte.ts
Listening history shared by the Home card and the side panel.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | HistoryStore | class | Holds history entries, a loading flag and request counters. |
| 17 | HistoryStore.load | method | Loads the last 100 entries, skipping fresh data and discarding stale responses. |

#### src/renderer/lib/keyboard.ts
Application-wide keyboard shortcut installer.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 18 | isFormControl | function | Returns true for editable or input, textarea and select targets. |
| 25 | installShortcuts | function | Binds the keydown handler and returns its uninstall function. |
| 26 | onKeyDown | arrow | Handles Escape, Space, arrows, and mute/shuffle/repeat/like shortcuts. |

#### src/renderer/lib/library-items.ts
Builds the unified Library grid from playlists, saved albums and downloads.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 25 | markFor | function | Classifies a download count as none, partial or full. |
| 30 | firstArt | function | Returns the first track thumbnail in a list. |
| 34 | countDownloaded | function | Counts tracks whose ids are in the downloaded set. |
| 38 | collectionArt | function | Picks collection art, then first entry art, then a track thumbnail. |
| 55 | buildLibraryItems | function | Merges liked songs, playlists, saved albums and collections into library tiles. |

#### src/renderer/lib/lyrics-sync.ts

Pure line lookup for the synced lyrics panel.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | lineIndexAt | function | Returns the last lyric line whose timestamp has been reached, or -1. |

#### src/renderer/lib/lyrics.svelte.ts
Session-cached lyrics state for the player button and the lyrics panel.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | LyricsState | class | Holds lyrics data, loading/error flags and a per-track cache. |
| 18 | LyricsState.load | method | Loads or reuses lyrics, ignoring responses for superseded tracks. |

#### src/renderer/lib/moods.svelte.ts
Mood and genre categories with ten-minute page caching.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 11 | Moods | class | Holds categories, loading/error state and a cached page map. |
| 19 | Moods.load | method | Fetches mood categories once unless forced, recording errors. |
| 36 | Moods.paramsFor | method | Maps a card title to YouTube's params, case-insensitively. |
| 41 | Moods.cached | method | Returns a non-expired cached mood page, or null. |
| 51 | Moods.remember | method | Caches a mood page and evicts the oldest beyond 20. |

#### src/renderer/lib/nav.svelte.ts
Single navigation store with browser-style back and forward stacks.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 52 | Navigator | class | Holds the current view, page references and back/forward history stacks. |
| 70 | Navigator.canGoBack | method | Reports whether a back entry exists. |
| 74 | Navigator.canGoForward | method | Reports whether a forward entry exists. |
| 78 | Navigator.revision | method | Exposes the counter bumped on each real navigation. |
| 82 | Navigator.go | method | Switches top-level view, clearing detail state and recording history. |
| 93 | Navigator.open | method | Opens a catalog detail page and clears track/collection/mood state. |
| 107 | Navigator.openReleaseAt | method | Opens a release and sets a focus target for scrolling and highlighting. |
| 118 | Navigator.clearFocus | method | Clears focus only when the nonce matches the active one. |
| 123 | Navigator.openMood | method | Opens a mood page unless that same page is already showing. |
| 132 | Navigator.openArtist | method | Builds an artist catalog item and opens its detail page. |
| 145 | Navigator.openTrack | method | Opens the song page with a copied track snapshot. |
| 156 | Navigator.openCollection | method | Opens a liked, playlist or download collection, skipping duplicates. |
| 171 | Navigator.back | method | Pops the back stack, pushes current onto forward and restores the entry. |
| 178 | Navigator.forward | method | Pops the forward stack, pushes current onto back and restores the entry. |
| 186 | Navigator.clearForward | method | Empties the forward stack after the page it points at is deleted. |
| 190 | Navigator.record | method | Pushes a snapshot, clears forward/focus and bumps the revision. |
| 197 | Navigator.pushBack | method | Pushes a snapshot onto the back stack, capped at 40 entries. |
| 202 | Navigator.pushForward | method | Pushes a snapshot onto the forward stack, capped at 40 entries. |
| 207 | Navigator.snapshot | method | Captures the current view and page references. |
| 217 | Navigator.restore | method | Applies a snapshot, clears focus and bumps the revision. |

#### src/renderer/lib/network.svelte.ts
Connectivity state mirrored from the main-process probe.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | NetworkStore | class | Holds network state and the one-time wiring flag. |
| 18 | NetworkStore.localFirst | method | True when forced offline or the host is not online. |
| 23 | NetworkStore.offline | method | True when forced offline or the link itself is down. |
| 27 | NetworkStore.label | method | Returns the user-facing connectivity label. |
| 34 | NetworkStore.detail | method | Returns the explanatory offline or connection message. |
| 41 | NetworkStore.init | method | Subscribes to changes, rechecks on link events and reads the initial state. |
| 47 | recheck | arrow | Asks main to re-probe connectivity, ignoring failures. |
| 64 | NetworkStore.setMode | method | Applies an offline-mode change made in Settings. |

#### src/renderer/lib/pixel-scramble.ts
Slot-machine digit scramble used by the clock animation.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 18 | scrambleClock | function | Builds one scramble frame, locking digits as elapsed time passes. |

#### src/renderer/lib/player-source.ts
Decides whether the audio element can reuse, keep or must detach its source.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 11 | sourceAction | function | Returns reuse/keep/detach for a track change based on ids and loaded src. |

#### src/renderer/lib/player.svelte.ts
The app-wide audio player: one element, queue, playback state and OS media integration.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 32 | isPlayable | function | True for song catalog items that carry an id. |
| 36 | toTrack | function | Converts a catalog item into a track, deriving credits, album and artist. |
| 72 | Player | class | Owns the single audio element, queue, playback state and media session. |
| 134 | Player.init | method | Wires audio and media handlers, applies settings and restores the session. |
| 154 | Player.applySettings | method | Adopts volume, mute, shuffle, repeat and autoplay from settings. |
| 165 | Player.restoreSession | method | Restores the saved queue, index and paused position from main. |
| 187 | Player.persistSession | method | Saves a plain track/queue snapshot, throttled unless immediate. |
| 210 | Player.updatePosition | method | Mirrors the audio clock into state at most once per second. |
| 220 | Player.wire | method | Installs play, pause, timeupdate, metadata, ended and error handlers. |
| 283 | Player.playList | method | Replaces the queue with playable items and starts at the given index. |
| 295 | Player.playItem | method | Plays one catalog item by replacing the queue. |
| 301 | Player.enqueue | method | Appends a playable item without starting playback. |
| 309 | Player.enqueueAll | method | Appends every playable item in a list. |
| 321 | Player.insertAt | method | Inserts an item at a queue slot and shifts the current index. |
| 334 | Player.playAt | method | Jumps to a queue index and starts playback. |
| 343 | Player.play | method | Resolves a pasted input, appends it to the queue and starts playback. |
| 392 | Player.next | method | Skips forward through `advance(1)`. |
| 397 | Player.previous | method | Restarts after three seconds, otherwise skips back one track. |
| 403 | Player.prefetch | method | Warms a track's stream URL through the prefetch channel. |
| 410 | Player.prefetchList | method | Prefetches the first few playable items in a list. |
| 414 | Player.toggle | method | Starts a restored track or toggles play/pause on the element. |
| 440 | Player.resume | method | Resumes playback, falling back to recovery on media failure. |
| 459 | Player.seek | method | Seeks the element or records a pending resume position before load. |
| 481 | Player.diagnostics | method | Exposes raw readyState, networkState, error code and seekable ranges. |
| 501 | Player.cancel | method | Cancels an in-flight resolve and clears the busy timer. |
| 512 | Player.setVolume | method | Clamps volume, updates the element and persists it debounced. |
| 523 | Player.toggleMute | method | Flips element mute and persists it. |
| 531 | Player.toggleShuffle | method | Flips shuffle and saves the setting. |
| 536 | Player.toggleAutoplay | method | Flips autoplay and saves the setting. |
| 541 | Player.cycleRepeat | method | Cycles repeat through off/all/one and saves it. |
| 547 | Player.clearQueue | method | Stops audio, clears the queue and persists the empty session. |
| 567 | Player.removeAt | method | Removes a queue row, restarting or clearing when it was the current one. |
| 585 | Player.move | method | Reorders a queue row and keeps the current index on its track. |
| 605 | Player.startTimer | method | Starts the elapsed-time interval for resolve progress. |
| 614 | Player.stopTimer | method | Clears the elapsed-time interval. |
| 621 | Player.persistSettings | method | Debounces settings patches into one IPC write. |
| 637 | Player.prefetchNext | method | Warms the next track or radio queue when appropriate. |
| 659 | Player.warmRadio | method | Fetches and caches the radio queue, warming its first playable URL. |
| 686 | Player.start | method | Resolves and plays the current queue track, swapping in official audio. |
| 857 | Player.recover | method | Re-resolves a failed stream up to twice, then fails playback. |
| 948 | Player.failPlayback | method | Shows a stopped state, detaches the dead source and clears the stream. |
| 965 | Player.advance | method | Computes the next index honouring shuffle/repeat, then starts it. |
| 1010 | Player.extendWithRadio | method | Appends up to 25 fresh radio tracks for autoplay. |
| 1034 | Player.recordHistory | method | Sends playback history with completion ratio and credits to main. |
| 1059 | Player.setMediaHandlers | method | Registers media session action handlers once. |
| 1062 | bind | arrow | Wraps `setActionHandler` in a try/catch for unsupported actions. |
| 1089 | Player.setTaskbarHandlers | method | Subscribes once to Windows taskbar button commands. |
| 1099 | Player.syncTaskbarControls | method | Pushes track, playing and previous/next flags to the Windows taskbar. |
| 1112 | Player.syncMetadata | method | Publishes MediaMetadata, upgrading local art to a data URL. |
| 1146 | Player.localArtwork | method | Reads a cached cover via main and memoizes an 8-entry data URL cache. |
| 1166 | Player.syncPlaybackState | method | Sets the media session playback state to playing or paused. |
| 1171 | Player.syncPositionState | method | Publishes duration, rate and clamped position to the media session. |
| 1186 | Player.currentTime | getter | Exact audio element clock for lyric sync; the reactive position stays throttled. |

#### src/renderer/lib/playlist-picker.svelte.ts
Anchored add-to-playlist popover state shared by every track row.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | PlaylistPicker | class | Holds the popover's open flag, target track and position. |
| 14 | PlaylistPicker.show | method | Positions the popover against an anchor and opens it for a track. |
| 25 | PlaylistPicker.close | method | Closes the popover and clears the target track. |

#### src/renderer/lib/playlists.svelte.ts
User playlists mirrored with generation guards against stale loads.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | Playlists | class | Holds playlist items, the loaded flag and a mutation generation. |
| 18 | Playlists.load | method | Loads playlists once unless forced, discarding responses older than a mutation. |
| 27 | Playlists.byId | method | Finds a playlist by id, or null. |
| 31 | Playlists.create | method | Creates a playlist via IPC and prepends it when still current. |
| 38 | Playlists.rename | method | Renames a playlist and replaces the local row when still current. |
| 44 | Playlists.remove | method | Deletes a playlist and drops it locally when still current. |
| 52 | Playlists.addTrack | method | Adds a plain track to a playlist and replaces the returned row. |
| 59 | Playlists.removeTrack | method | Removes a track from a playlist and replaces the returned row. |
| 65 | Playlists.replace | method | Swaps one playlist in the local list by id. |

#### src/renderer/lib/quality.ts
Human-readable codec and bitrate labels for streams.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 4 | codecLabel | function | Maps a file extension to AAC, OPUS, MP3 or the uppercased extension. |
| 20 | qualityLabel | function | Combines codec and bitrate into a display label, or null. |

#### src/renderer/lib/rail-fit.ts
Fits whole cards into a carousel rail and handles Windows wheel scrolling.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 31 | railLayout | function | Computes the column count and card width that fit the available pixels. |
| 51 | wantsWheelScroll | function | True when the platform is Windows, so the wheel should scroll sideways. |
| 60 | fitRail | function | Observes a rail's size and children, setting `--rail-card-width` and `data-rail-cols`. |
| 63 | update | arrow | Measures the rail and writes its card width and column count. |
| 77 | schedule | arrow | Coalesces updates into one animation frame. |
| 85 | onWheel | arrow | Routes vertical wheel delta to horizontal scroll on Windows. |
| 115 | destroy | method | Disconnects observers, removes the wheel listener and cancels a frame. |

#### src/renderer/lib/release.ts
Decides what clicking a song title does: open its release, or the song page.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 24 | isSingle | function | True when a release type is "single", case-insensitively. |
| 33 | browse | function | Returns a cached browse result or fetches and caches one. |
| 42 | songRows | function | Playable rows from a browse result. |
| 46 | releaseItem | function | Builds the release page item from its browse header. |
| 59 | lookup | function | Finds a release whose title and credited artist both match; never takes a same-name hit. |
| 69 | taggedRelease | function | Loads the release a track points at, by id or verified name, with its rows. |
| 95 | discoverAlbum | function | Searches albums by cleaned song title and artist and keeps only one that contains the recording. |
| 139 | openInRelease | function | Opens the release and focuses the exact matched row when it is known. |
| 169 | stale | arrow | True when a newer click or navigation superseded this request. |
| 160 | openTrackTarget | function | Album-first: opens the release at the song, or the song page when no album owns it. |
| 193 | openTrackFromItem | function | Opens the release/song target for a song catalog item, ignoring other kinds. |

#### src/renderer/lib/saved-albums.svelte.ts
Releases saved to the library, mirrored for the release page and Library grid.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | SavedAlbums | class | Holds saved album items plus load guards. |
| 14 | SavedAlbums.has | method | Checks whether an album id is saved. |
| 18 | SavedAlbums.load | method | Loads saved albums once unless forced, guarding concurrent calls. |
| 29 | SavedAlbums.toggle | method | Toggles a saved release via IPC and replaces the album list. |

#### src/renderer/lib/search.svelte.ts
Search state that survives view changes, debouncing queries and filtering offline rows.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | SearchState | class | Holds query, filter, results, loading/error and the source marker. |
| 26 | SearchState.visibleItems | method | Returns results only while online rows match the current connectivity mode. |
| 30 | SearchState.setQuery | method | Stores the query, invalidates in-flight work and debounces a load. |
| 52 | SearchState.setFilter | method | Switches category, clearing rows and reloading when online. |
| 64 | SearchState.submit | method | Cancels the debounce and loads immediately for an Enter commit. |
| 77 | SearchState.refreshSource | method | Drops online rows on connectivity change and reruns the retained query. |
| 88 | SearchState.load | method | Runs combined or per-category searches, discarding superseded responses. |
| 146 | SearchState.clearResults | method | Invalidates the sequence and clears rows, source, error and loading. |

#### src/renderer/lib/side-panel.svelte.ts
State for the single docked side panel and its lyrics/queue/history modes.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 9 | SidePanelState | class | Holds the active panel mode, or null when closed. |
| 12 | SidePanelState.open | method | True when any panel mode is active. |
| 16 | SidePanelState.toggle | method | Opens a mode, or closes it when that mode is already active. |
| 20 | SidePanelState.close | method | Closes the panel. |

#### src/renderer/lib/toast.svelte.ts
One transient toast message with an auto-dismiss timer.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | ToastState | class | Holds the current message and its dismiss timer. |
| 13 | ToastState.show | method | Shows a message and resets the dismiss timer. |
| 22 | ToastState.clear | method | Cancels the timer and empties the message. |

#### src/renderer/lib/track-drag.svelte.ts
Publishes the song currently being dragged so drop targets can identify it.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 12 | TrackDragState | class | Holds the dragged item and its source row id. |
| 18 | TrackDragState.active | method | True while a drag is in flight. |
| 22 | TrackDragState.begin | method | Records the dragged item and its source row. |
| 27 | TrackDragState.end | method | Clears the dragged item and source. |
| 36 | isTrackDrag | function | True when a drag event carries the custom Viby track type. |

#### src/renderer/lib/track.ts
Track/catalog-item conversions and IPC-safe plain copies.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 12 | plainTrack | function | Shallow-copies a track and deep-copies `artistParts` so it survives IPC. |
| 18 | plainParts | function | Copies each subtitle part into a plain object. |
| 23 | trackToItem | function | Converts a track into a song catalog item with credit and album parts. |

#### src/renderer/lib/updates.svelte.ts
Update state mirrored from the main-process updater.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 8 | UpdateStore | class | Holds the update state, focus request and one-time wiring flag. |
| 16 | UpdateStore.pending | method | True for available, ready or manual updates the user has not skipped. |
| 22 | UpdateStore.init | method | Subscribes to changes, then reads the initial state if no broadcast won. |
| 37 | UpdateStore.check | method | Asks main to check for updates and stores the result. |
| 41 | UpdateStore.download | method | Starts the download, tolerating the app quitting before the reply. |
| 50 | UpdateStore.cancel | method | Cancels the download without copying the pre-abort reply. |
| 57 | UpdateStore.requestFocus | method | Asks Settings to reveal the update card when one is pending. |
| 62 | UpdateStore.clearFocus | method | Clears a handled focus request if its nonce still matches. |
| 66 | UpdateStore.install | method | Installs the update, tolerating the app quitting before the reply. |

### 12.5 Renderer — components

Scope: every `.svelte` file under `src/renderer/components/`. Script-level symbols only (no template markup, no `$state`/`$derived` data, no CSS, no type declarations).

#### src/renderer/components/ArtistLinks.svelte

Renders structured artist credits as buttons that open artist pages without triggering row playback.

No functions or classes are defined in this component.

#### src/renderer/components/ChangelogDialog.svelte

Modal "What's new" sheet listing release notes with a focus trap and Escape dismissal.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 10 | formatDate | function | Formats an ISO `YYYY-MM-DD` changelog date as a long locale date; returns empty on mismatch. |
| 21 | sectionLabels | function | Returns true when an entry has multiple sections, so section titles render. |
| 25 | onKeydown | function | Window handler: Escape dismisses the dialog, Tab wraps focus inside the sheet. |

#### src/renderer/components/CollectionDownloadButton.svelte

Shared album/playlist download control: download, pause, resume and cancel in one place.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 43 | toggle | function | Removes when complete, pauses while active, resumes when paused, retries failures, else enqueues the collection. |
| 75 | cancel | function | Cancels the collection's remaining jobs. |

#### src/renderer/components/CollectionView.svelte

Liked-songs or playlist page with hero, download/rename/delete controls and a paged track list.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 80 | loadLiked | function | Fetches favourite tracks into local state. |
| 84 | playAll | function | Plays the offline-available items from the first one. |
| 88 | remove | function | Removes a row: unfavourites and reloads, or removes the track from the playlist. |
| 100 | startRename | function | Seeds the draft with the playlist name and enters rename mode. |
| 106 | commitRename | function | Prevents submit, renames the playlist, leaves rename mode. |
| 113 | deletePlaylist | function | Deletes the playlist, then navigates back and clears forward history. |

#### src/renderer/components/Cover.svelte

Renders artwork with a derived failure guard so dead URLs fall back to a placeholder.

No functions or classes are defined in this component.

#### src/renderer/components/DetailView.svelte

Album, artist or playlist catalogue page with cached browse, shelves, downloads and save-to-library.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 67 | shelfLabel | function | Maps raw shelf titles to display labels, passing unknown titles through. |
| 91 | bannerFailed | function | Records a failed banner URL and marks the artwork broken in the artwork store. |
| 163 | withDefaults | function | Clones a row, filling fallback artist, page release metadata and header artwork. |
| 204 | albumSnapshot | function | Builds the SavedAlbum record (title, artist, art, year, track count) for saving. |
| 219 | toggleAlbumSave | function | Saves or unsaves the album snapshot, swallowing local write errors. |
| 258 | load | function | Browses a catalogue id, guards stale requests, caches the result and prefetches songs. |
| 281 | retry | function | Re-runs the browse after a failure with a fresh request token. |
| 364 | playAll | function | Plays the page track list (top songs on artist pages) from the start. |
| 369 | activate | function | Plays a card when playable, else navigates; album-from-artist keeps the artist credit. |

#### src/renderer/components/DownloadBadge.svelte

Small downloaded or partial-progress badge with an accessible label.

No functions or classes are defined in this component.

#### src/renderer/components/DownloadCollectionView.svelte

Local-first page for one downloaded collection with metadata, play-all and removal.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 65 | playAll | function | Plays all downloaded entries of the collection from the start. |
| 69 | removeCollection | function | Confirms, removes the whole download collection, then navigates back. |
| 81 | removeEntry | function | Confirms, then prunes one entry, or removes the collection when it was last. |

#### src/renderer/components/DownloadPanel.svelte
Docked panel body that groups pending downloads and exposes per-item/collection pause, resume, cancel and retry.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 12 | statusLabel | function | Maps a job state to the panel's short status copy. |
| 25 | groupMeta | function | Builds the collection coverage and status subtitle. |
| 33 | jobMeta | function | Shows a live percentage while downloading, otherwise the state label. |
| 37 | cancelGroup | function | Cancels every remaining job owned by a collection. |
| 41 | openLibrary | function | Closes the panel and opens the Library download surface. |
| 46 | pauseGroup | function | Pauses every remaining job in the group's collection. |
| 50 | resumeGroup | function | Resumes the collection's paused jobs. |

#### src/renderer/components/DownloadIndicator.svelte

Titlebar download control: the standard download glyph with a subtle drift, a drawn completion check and a failure mark.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 73 | holdSuccess | function | Shows the completion check, holds it, then fades the badge out. |
| 86 | clearTimers | function | Cancels the success hold/exit timers on unmount or new work. |
| 91 | toggle | function | Opens or closes the docked Downloads panel. |

#### src/renderer/components/EntityLink.svelte

Inline artist or album name button that navigates without bubbling the click.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 20 | open | function | Stops propagation and opens the artist or album page for the linked name. |

#### src/renderer/components/HistoryPanel.svelte

Side panel listing playback history, loading it once on mount.

No functions or classes are defined in this component.

#### src/renderer/components/HomeView.svelte

Home shelves plus recent-listening dashboard and mood grid, backed by a shared shelf store.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 42 | load | function | Fetches home shelves into the shared store and prefetches the first shelf. |
| 64 | loadRecent | function | Throttled (10s) refresh of history and weekly summary feeding the dashboard card. |
| 88 | play | function | Plays the item at its position within the filtered playable list. |
| 94 | activate | function | Plays playable cards, otherwise navigates to the item's page. |

#### src/renderer/components/Icon.svelte

Inline SVG icon set driven by name, size and solid props.

No functions or classes are defined in this component.

#### src/renderer/components/ImportView.svelte

Multi-phase playlist import wizard: resolve, match, review and create.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 51 | candidateOf | function | Resolves the row's chosen candidate id to a Track, or null. |
| 56 | reset | function | Returns the wizard to idle and invalidates in-flight attempts. |
| 68 | submit | function | Resolves the URL, matches tracks via API with generation guards, moves to review. |
| 109 | cancel | function | Invalidates the attempt, cancels the main-process import and resets progress. |
| 118 | choose | function | Sets the chosen candidate from the select value and includes the row. |
| 124 | toggle | function | Flips row inclusion when the row has a chosen candidate. |
| 129 | selectAll | function | Includes or excludes every row that has a chosen candidate. |
| 133 | create | function | Creates the playlist from selected plain tracks, reloads playlists, moves to done. |
| 158 | serviceName | function | Maps an import service id to its display name. |
| 173 | artistsOf | function | Joins the source track's artists, falling back to "Unknown artist". |
| 177 | percent | function | Returns rounded import progress percent, 0 when the total is unknown. |

#### src/renderer/components/InlineAlert.svelte

Generic alert box with an optional action button.

No functions or classes are defined in this component.

#### src/renderer/components/LibraryView.svelte

Library hub listing playlists, saved albums and downloads, with filters and playlist creation.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 78 | loadFavorites | function | Loads liked tracks into local state. |
| 82 | create | function | Creates a playlist from the name field, closes the form, opens the new playlist. |
| 91 | removeSong | function | Confirms and removes a downloaded track. |
| 96 | openItem | function | Opens a library entry: collection ref, or album page when not downloaded local-first. |

#### src/renderer/components/ListeningDashboard.svelte

Weekly listening snapshot: pixel clock, top artists, best day and recent tracks.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 91 | listeningTime | function | Formats seconds as `Xm` or `Xh Ym`. |
| 99 | plural | function | Formats a count with its singular or plural noun. |
| 103 | showHistory | function | Toggles the history side panel. |
| 107 | monogram | function | Builds a two-letter uppercase monogram from an artist name. |
| 117 | openArtist | function | Navigates to the artist page, or falls back to an artist search when unlinked. |

#### src/renderer/components/LyricsPanel.svelte

Synced lyrics panel that centres and seeks the active line.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 81 | seek | function | Seeks the player to a clicked lyric line's timestamp. |

#### src/renderer/components/MediaCard.svelte

Square catalogue card with art, title, subtitle and an activate callback.

No functions or classes are defined in this component.

#### src/renderer/components/MoodGrid.svelte

Fixed grid of mood cards that opens YouTube mood mixes.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 45 | open | function | Awaits mood categories when still empty, then navigates to the card's mood page. |

#### src/renderer/components/MoodView.svelte

Mood browse page rendering cached mood shelves.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 23 | load | function | Loads mood results from cache or the browse API with a stale-token guard. |
| 52 | activate | function | Plays a playable item alone, otherwise navigates to it. |

#### src/renderer/components/OfflineHome.svelte

Offline landing page surfacing downloaded collections, recent downloads and loose songs.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 48 | collectionItem | function | Builds a card item for a download collection, with a song-count subtitle. |
| 59 | openCollection | function | Navigates to the local download collection page. |
| 63 | playCollection | function | Plays the given downloaded tracks from the start. |
| 67 | playAll | function | Plays every downloaded entry from the start. |

#### src/renderer/components/PixelClock.svelte

5x7 dot-matrix clock drawn as SVG with a boot scramble animation.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 67 | finish | function | Stops the scramble interval and snaps the display to the final value. |

#### src/renderer/components/PlayerBar.svelte

Dock player: track meta, transport, seek with hover preview, volume and queue drop target.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 23 | queueDragOver | function | Accepts track drags over the queue button, setting a copy cursor and hover state. |
| 30 | onQueueDrop | function | Enqueues the dragged track and shows a toast. |
| 69 | onVolumeWheel | function | Accumulates wheel pixels into 1% volume steps, hints, and ignores lowering while muted. |
| 96 | resetVolumeWheel | function | Discards accumulated wheel pixels between gestures. |
| 124 | onSeekInput | function | Starts scrubbing and stores the slider's value. |
| 129 | onSeekCommit | function | Seeks to the dragged value and ends scrubbing. |
| 140 | schedulePreview | function | Throttles to one animation frame and computes the hover time preview. |
| 152 | clearPreview | function | Cancels a pending preview frame and hides the tooltip. |
| 164 | toggleFav | function | Toggles favourite state for the current track, logging failures. |

#### src/renderer/components/PlaylistPicker.svelte

Popover that adds the selected or dragged track to a playlist, or a new one.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 12 | clearCloseTimer | function | Cancels the pending auto-close timer. |
| 30 | onKey | arrow | Escape listener registered in `onMount`; closes the picker and removes itself on unmount. |
| 43 | add | function | Adds the current track, shows "added", then auto-closes after 600ms. |
| 51 | createAndAdd | function | Creates a playlist from the name field, adds the track and closes. |

#### src/renderer/components/QueueDropBar.svelte

Always-available "add to queue" drop target shown while a track is being dragged.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | onDragOver | function | Prevents default for drags, sets copy effect and highlights the bar. |
| 20 | onDrop | function | Enqueues the dragged item and shows a toast. |

#### src/renderer/components/QueuePanel.svelte

Side-panel queue with pointer drag reordering, autoscroll and keyboard reordering.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 54 | rows | function | Returns the list's direct `li` rows. |
| 59 | externalSlotAt | function | Computes the insertion slot for drags that started outside the queue. |
| 69 | externalLineTop | function | Returns the y offset of the insertion line for an external slot. |
| 79 | onDragOver | function | Accepts track drags and previews the external drop slot and line. |
| 88 | onDragLeave | function | Clears the external preview on leaving, ignoring moves into children. |
| 94 | onDrop | function | Inserts the dragged item at the previewed slot and toasts. |
| 105 | measure | function | Captures row boxes in scroll-content coordinates so autoscroll cannot skew slots. |
| 114 | slotAt | function | Computes the insertion slot from a client Y using frozen row boxes. |
| 125 | targetFor | function | Converts a pre-drag slot into a final index after the dragged row is removed. |
| 130 | linePosition | function | Returns the insertion line offset for a slot. |
| 137 | update | function | Applies pointer movement: threshold, slot, line and autoscroll direction. |
| 154 | autoScroll | function | Steps the scroll near edges and keeps the animation-frame loop running. |
| 164 | startDrag | function | Begins a pointer drag, captures the pointer and registers window listeners. |
| 194 | onPointerMove | function | Routes matching pointer moves to `update`. |
| 199 | onPointerUp | function | Ends the drag and commits the move when the row actually moved. |
| 207 | onEscape | function | Cancels an active drag on Escape. |
| 213 | stopDrag | function | Removes listeners, cancels the frame loop and resets drag and line state; also used by `onDestroy`. |
| 225 | commitMove | function | Calls `player.move`, announces the new position and refocuses the grip. |
| 232 | refocus | function | After a tick, focuses the grip button at the new index. |
| 237 | reorderByKey | function | Arrow, Home and End keys reorder the focused row through `commitMove`. |

#### src/renderer/components/Rail.svelte

Horizontally paged shelf rail with overflow-aware chevrons.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | update | arrow | Measures overflow and start/end state; wired to scroll, resize and mutation observers. |
| 50 | page | function | Scrolls the rail by about 85% of its width, honouring reduced motion. |

#### src/renderer/components/SearchBar.svelte

Titlebar quick-search palette with grouped suggestions, recents and keyboard navigation.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 67 | emptyQuick | function | Returns an empty grouped-results object. |
| 71 | cloneQuick | function | Shallow-copies the three result arrays. |
| 79 | loadRecents | function | Reads recent queries from localStorage, tolerating malformed data. |
| 89 | saveRecents | function | Persists recents to localStorage, ignoring storage failures. |
| 97 | remember | function | Dedupes, prepends the query, caps at six and saves. |
| 105 | cacheKey | function | Normalises a query for quick-result cache lookup. |
| 109 | isSearchPage | function | True when the search view is showing with no detail, track or collection open. |
| 120 | portal | function | Svelte action that appends the palette to `body` and returns a teardown. |
| 123 | destroy | arrow | Teardown returned by `portal`; detaches the portaled node from `body`. |
| 127 | close | function | Closes the palette and clears the active index. |
| 132 | resetQuick | function | Invalidates the sequence, clears timer, groups, loading flags and error. |
| 144 | scheduleQuick | function | Debounces quick search, serves cached groups, skips on search page or offline. |
| 186 | fetchQuick | function | Runs three filtered searches in parallel, merges results and caches the snapshot. |
| 197 | finish | arrow | Per-group callback: filters by kind and limit, updates loading, caches once all settle. |
| 294 | onInput | function | Pushes typed text to `searchState` and schedules quick results. |
| 308 | onFocus | function | Opens the palette and fetches immediately when the query is stale. |
| 321 | onInputClick | function | Reopens the palette after Escape without needing a refocus. |
| 337 | onFocusOut | function | Closes unless focus moved into the wrapper or the portaled panel. |
| 345 | onWindowPointerDown | function | Closes the palette on an outside pointer press. |
| 351 | focusSearch | function | Focuses and selects the input, opening the palette; used by `/` and Cmd/Ctrl+K. |
| 365 | onWindowKeydown | function | Global shortcuts: `/` and Cmd/Ctrl+K focus search, skipping typing targets. |
| 389 | move | function | Moves the keyboard selection by a delta with wrap-around. |
| 402 | commit | function | Remembers the query, submits the search, closes and navigates to search. |
| 415 | useRecent | function | Applies a recent query, submits, remembers, closes and navigates. |
| 425 | showMore | function | Submits the search with a group's filter and closes the palette. |
| 436 | choose | function | Acts on an option: reuse recent, play song, open artist, or navigate. |
| 461 | onInputKeydown | function | Input keys: Escape closes or blurs, arrows move, Enter chooses or commits. |
| 491 | clear | function | Clears query and quick results and reopens the palette unless offline. |
| 503 | clearRecents | function | Empties and persists recents, then refocuses the input. |

#### src/renderer/components/SearchView.svelte

Full search results page with filter tabs, a hero result and card grids.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 53 | columnsFor | arrow | Computes grid column count from width, card width and gap; used by the panel-freeze effect. |
| 69 | loadRecents | function | Reads up to eight recent queries from localStorage. |
| 101 | activate | function | Plays a song, opens an artist, or navigates for other kinds. |
| 111 | showAll | function | Applies a search filter tab. |
| 115 | useRecent | function | Applies a recent query and submits the search. |

#### src/renderer/components/SettingsView.svelte

Settings page: cache stats, offline toggle, yt-dlp resolver and a highlighted update card.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 43 | revealUpdateSection | function | Scrolls the update card into view, re-asserting briefly while settings rows settle. |
| 108 | load | function | Loads settings and cache stats, applies them to the player, inits downloads and the resolver. |
| 117 | loadResolver | function | Fetches yt-dlp info with busy and error state. |
| 131 | updateResolver | function | Triggers a yt-dlp update and stores the returned info. |
| 145 | patch | function | Writes partial settings, re-applies them to the player and refreshes cache stats. |
| 152 | toggleOffline | function | Flips network mode between offline and auto, then reloads settings. |
| 158 | clearCache | function | Clears the cache and forgets artwork mappings so covers re-resolve. |
| 169 | checkUpdates | function | Delegates to `updates.check`. |
| 173 | downloadUpdate | function | Delegates to `updates.download`. |
| 177 | cancelDownload | function | Delegates to `updates.cancel`. |
| 181 | installUpdate | function | Delegates to `updates.install`. |
| 185 | skipUpdate | function | Stores the skipped version, then re-checks for updates. |
| 192 | clearSkipped | function | Clears the skipped version, then re-checks for updates. |
| 200 | actionFor | function | Maps an update phase to the button label, disabled flag and handler. |
| 221 | updateHint | function | Returns explanatory text for each update phase. |
| 246 | size | function | Formats bytes as GB with one decimal or as MB, returning an em dash for null. |

#### src/renderer/components/SidePanel.svelte

Side-panel shell switching between queue, history and lyrics, owning the opening loading beat.

No functions or classes are defined in this component.

#### src/renderer/components/SubtitleParts.svelte

Renders structured subtitle parts, linking entities that are artists.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 16 | looksLikeArtist | function | Heuristically rejects separators, media labels, view counts and durations as artists. |

#### src/renderer/components/TrackRow.svelte

Dense track row with play, favourite, download, playlist, drag and remove actions.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 107 | hoverStart | function | Starts an 80ms timer that prefetches the row's stream. |
| 112 | hoverEnd | function | Cancels the pending prefetch timer; also registered with `onDestroy`. |
| 121 | activate | function | Plays the track within its context, or navigates when not blocked. |
| 133 | dragGhost | function | Builds a compact cover-and-title drag image that removes itself after a tick. |
| 178 | dragStart | function | Begins a queued drag with copy effect, payload data and drag image. |
| 197 | dragEnd | function | Ends the drag session in the drag store. |
| 201 | toggleFavorite | function | Toggles favourite state for the row's track, swallowing errors. |
| 210 | toggleDownload | function | Download button state machine: remove, cancel, retry or add the track. |

#### src/renderer/components/TrackView.svelte

Single saved-track page with related radio tracks.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 50 | asItem | function | Converts the saved track into a catalogue item. |
| 54 | togglePlay | function | Toggles playback when current, otherwise plays this track alone. |
| 59 | openAlbumPage | function | Opens the album page when the track carries album info. |

### 12.6 Shared, preload and scripts

#### src/shared/artist-credits.ts

Turns structured subtitle runs or a combined credit string into per-artist linkable parts.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 14 | isSeparator | function | Detects punctuation-only credit fragments such as " • " or ", " that carry no id. |
| 19 | isArtistName | function | Rejects separators and connector words (feat, ft, with, vs, and, x) from credit runs. |
| 25 | isCounter | function | Private guard that filters out play/view counters and durations from credits. |
| 40 | creditParts | function | Copies subtitle parts up to the album/counter boundary, drops a leading page-type tag and trims separators. |
| 81 | splitArtistParts | function | Conservatively splits a combined credit string, drops a legacy row tag and gives the stored id to the first name. |
| 113 | artistPartsFor | function | Returns sanitized structured credits, falling back to splitArtistParts on the display string. |
| 124 | artistNames | function | Maps credit parts to trimmed artist names for callers that need a plain list. |

#### src/shared/changelog.ts

Decides which baked release notes a launch should show from the seen/shown version baselines.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 15 | previousVersion | function | Returns the newest baked version strictly older than the given version, or an empty string. |
| 26 | baselineFor | function | Private resolver that reconciles lastSeenVersion with lastShownVersion into one notes baseline. |
| 50 | unseenEntries | function | Filters entries newer than the baseline, newest first; a first run yields nothing. |

#### src/shared/ipc.ts

Single source of truth for IPC channel names plus the VibyApi contract and request payload types.

_No function, method, class, or arrow declarations (constants and type declarations only)._

#### src/shared/listening.ts

Aggregates local history into a seven-day listening summary and converts entries back into catalog rows.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | summarizeHistory | function | Rolls history entries into per-day and per-artist totals, weighted by duration times completion. |
| 92 | historyItem | function | Rebuilds a CatalogItem from a history entry with sanitized credits and an album link carrying its artist. |

#### src/shared/track-match.ts

Release-row matching for song-title clicks.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 23 | releaseSearchTitle | function | Drops parenthetical qualifiers for the album-discovery query only. |
| 36 | pickTrackIndex | function | Exact id, then title key, then duration; refuses a clearly different recording. |

#### src/shared/track-title.ts

Normalizes song titles so video, audio and remaster variants compare equal.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 6 | trackTitleKey | function | Lowercases a title and strips video/audio/quality markers to produce a comparison key. |

#### src/shared/types.ts

Shared data model for tracks, catalog, library, downloads, imports, updates and IPC results.

_No function, method, class, or arrow declarations (type declarations only)._

#### src/shared/version.ts

Minimal SemVer parsing and comparison used by update checks and release notes.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 17 | parseVersion | function | Parses an optional-`v` SemVer string into numeric parts and prerelease identifiers, or null. |
| 28 | compareIdentifiers | function | Private semver §11.4.3 identifier ordering, ranking numeric ids below alphanumeric ones. |
| 39 | compareVersions | function | Returns -1, 0 or 1 for two versions; unparseable inputs compare equal. |
| 66 | isNewer | function | True when the candidate version outranks the current one. |

#### src/preload/index.ts

Builds the sandboxed `viby` bridge object and exposes it to the renderer via contextBridge.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 37 | api.app.onOpenSettings | arrow | Subscribes to the main-process open-settings event and returns an unsubscribe closure. |
| 38 | api.app.onOpenSettings.handler | arrow | Wraps the callback so the IPC event argument is dropped for the renderer. |
| 42 | api.app.onNavigate | arrow | Subscribes to OS back/forward navigation commands and returns an unsubscribe closure. |
| 43 | api.app.onNavigate.handler | arrow | Forwards only the navigation command from the IPC event to the callback. |
| 47 | api.app.copyText | arrow | Invokes main to copy diagnostic text to the OS clipboard. |
| 48 | api.app.changelog | arrow | Invokes main for the release notes baked into this build. |
| 51 | api.settings.get | arrow | Invokes main to read persisted settings. |
| 52 | api.settings.set | arrow | Invokes main to merge a partial settings patch and return the result. |
| 55 | api.session.get | arrow | Invokes main to restore the saved playback session. |
| 56 | api.session.save | arrow | Invokes main to persist the current playback session. |
| 59 | api.lyrics.get | arrow | Invokes main to fetch lyrics for the requested track. |
| 62 | api.player.resolve | arrow | Invokes main to resolve a URL or id into a playable stream. |
| 63 | api.player.prefetch | arrow | Fire-and-forget send that warms a stream URL in the background. |
| 64 | api.player.cancel | arrow | Sends an abort for the in-flight resolve. |
| 65 | api.player.setPlaying | arrow | Sends play/pause state so main can hold the power blocker. |
| 66 | api.player.setPresence | arrow | Sends a presence snapshot for Discord Rich Presence. |
| 68 | api.player.setTaskbarControls | arrow | Sends taskbar thumbnail control state on Windows. |
| 69 | api.player.onCommand | arrow | Subscribes to taskbar media commands and returns an unsubscribe closure. |
| 70 | api.player.onCommand.handler | arrow | Forwards only the media command from the IPC event to the callback. |
| 76 | api.catalog.search | arrow | Invokes main catalog search with an optional type filter. |
| 78 | api.catalog.browse | arrow | Invokes main to browse a page, passing Moods & Genres params when present. |
| 80 | api.catalog.home | arrow | Invokes main for the home shelves. |
| 81 | api.catalog.moods | arrow | Invokes main for the moods and genre tiles. |
| 82 | api.catalog.radio | arrow | Invokes main for related tracks seeded by a video id. |
| 83 | api.catalog.audioTrack | arrow | Invokes main to find the released audio track for a music video. |
| 85 | api.catalog.artistImage | arrow | Invokes main to resolve an artist portrait by id or name. |
| 89 | api.history.add | arrow | Invokes main to append a play to history. |
| 90 | api.history.list | arrow | Invokes main for recent history, optionally limited. |
| 91 | api.history.summary | arrow | Invokes main for the seven-day listening summary. |
| 94 | api.favorites.list | arrow | Invokes main for the liked tracks. |
| 95 | api.favorites.toggle | arrow | Invokes main to toggle a track's favorite state and return the new list. |
| 98 | api.library.playlists | arrow | Invokes main for all user playlists. |
| 99 | api.library.createPlaylist | arrow | Invokes main to create a playlist with the given name. |
| 100 | api.library.renamePlaylist | arrow | Invokes main to rename a playlist by id. |
| 102 | api.library.deletePlaylist | arrow | Invokes main to delete a playlist by id. |
| 103 | api.library.addToPlaylist | arrow | Invokes main to append a track to a playlist. |
| 105 | api.library.removeFromPlaylist | arrow | Invokes main to drop a track id from a playlist. |
| 107 | api.library.albums | arrow | Invokes main for saved releases. |
| 108 | api.library.toggleAlbum | arrow | Invokes main to toggle a saved album and return the new list. |
| 111 | api.cache.stats | arrow | Invokes main for cache size and entry statistics. |
| 112 | api.cache.clear | arrow | Invokes main to clear the audio cache and return fresh stats. |
| 115 | api.images.cache | arrow | Invokes main to cache remote artwork and map URLs to local media URLs. |
| 116 | api.images.dataUrl | arrow | Invokes main to read a cached image back as a data URL. |
| 119 | api.network.get | arrow | Invokes main for the current connectivity state. |
| 120 | api.network.setMode | arrow | Invokes main to persist the manual offline switch and return the resulting state. |
| 121 | api.network.recheck | arrow | Invokes main to re-probe connectivity now. |
| 122 | api.network.onChange | arrow | Subscribes to connectivity changes and returns an unsubscribe closure. |
| 123 | api.network.onChange.handler | arrow | Forwards only the network state from the IPC event to the callback. |
| 129 | api.updates.get | arrow | Invokes main for the current update state. |
| 130 | api.updates.check | arrow | Invokes main to ask GitHub for the latest release without downloading. |
| 131 | api.updates.download | arrow | Invokes main to download the update (or open the DMG on macOS). |
| 132 | api.updates.cancel | arrow | Invokes main to abort an in-progress update download. |
| 133 | api.updates.install | arrow | Invokes main to quit, install and relaunch on Windows. |
| 134 | api.updates.onChange | arrow | Subscribes to update state changes and returns an unsubscribe closure. |
| 135 | api.updates.onChange.handler | arrow | Forwards only the update state from the IPC event to the callback. |
| 141 | api.downloads.snapshot | arrow | Invokes main for the full downloads snapshot. |
| 142 | api.downloads.addTrack | arrow | Invokes main to download a single track. |
| 143 | api.downloads.addCollection | arrow | Invokes main to download a collection with its track list. |
| 145 | api.downloads.removeTrack | arrow | Invokes main to remove one downloaded track. |
| 146 | api.downloads.removeCollection | arrow | Invokes main to remove a downloaded collection by key. |
| 147 | api.downloads.pruneCollection | arrow | Invokes main to drop specific tracks from a collection without affecting other owners. |
| 149 | api.downloads.clear | arrow | Invokes main to delete every download. |
| 150 | api.downloads.retry | arrow | Invokes main to retry a failed download job. |
| 151 | api.downloads.cancel | arrow | Invokes main to cancel a download job. |
| 152 | api.downloads.onChanged | arrow | Subscribes to downloads snapshot pushes and returns an unsubscribe closure. |
| 153 | api.downloads.onChanged.handler | arrow | Forwards only the snapshot from the IPC event to the callback. |
| 157 | api.downloads.onProgress | arrow | Subscribes to per-job download progress and returns an unsubscribe closure. |
| 158 | api.downloads.onProgress.handler | arrow | Forwards only the progress payload from the IPC event to the callback. |
| 162 | api.downloads.cancelCollection | arrow | Invokes main to stop remaining jobs for a collection without removing completed songs. |
| 164 | api.ytDlp.info | arrow | Invokes main to report the resolved yt-dlp runtime details. |
| 165 | api.ytDlp.update | arrow | Invokes main to self-update yt-dlp and report the new runtime info. |
| 168 | api.import.resolve | arrow | Invokes main to resolve an external playlist URL into a normalized source. |
| 169 | api.import.match | arrow | Invokes main to match imported tracks against YouTube Music. |
| 170 | api.import.cancel | arrow | Invokes main to stop an in-flight import match. |
| 171 | api.import.create | arrow | Invokes main to create a playlist from the matched tracks. |
| 172 | api.import.onProgress | arrow | Subscribes to import match progress and returns an unsubscribe closure. |
| 173 | api.import.onProgress.handler | arrow | Forwards only the progress payload from the IPC event to the callback. |
| 181 | api.debug.forgetHistory | arrow | Debug-only e2e hook that asks main to forget synthetic history titles. |

#### scripts/build-changelog.mjs

Bakes annotated-tag release notes into resources/changelog.json for the in-app What's New sheet.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 29 | parseTagVersion | function | Parses a `vX.Y.Z` tag into a numeric triple, or null for unsupported tags. |
| 34 | compareParts | function | Compares two version triples and returns -1, 0 or 1. |
| 47 | parseReleaseNotes | function | Extracts h3 sections and their bullets, flattening inline Markdown in each bullet. |
| 74 | plainText | function | Strips links, bold and code markers so the sheet can render plain text. |
| 87 | collectEntries | function | Keeps tags at or below the running version, sorts newest first, and builds ChangelogEntry records. |
| 105 | readTags | function | Runs git to read every `v*` tag with its creation date and message. |
| 122 | main | function | CLI entry that writes resources/changelog.json and fails release builds lacking current notes. |

#### scripts/check-release-notes.mjs

Lints release-notes Markdown for allowed sections, bullets and implementation jargon.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 57 | checkReleaseNotes | function | Returns human-readable problems for unknown/duplicate/empty sections and banned terms. |
| 111 | main | function | CLI entry that reads the notes file, prints errors and exits non-zero on failure. |

#### scripts/fetch-runtime.mjs

Vendors a pinned python-build-standalone runtime and the yt-dlp zipapp into resources/.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 41 | option | arrow | Reads a `--name value` CLI option, falling back to the host default. |
| 120 | vendorZipapp | function | Downloads the latest yt-dlp zipapp to resources/bin unless already present. |
| 136 | signMachOFiles | function | Ad-hoc signs every Mach-O file in the vendored tree and returns the count. |
| 160 | isMachO | function | Reads a file's magic bytes to decide whether codesign must process it. |
| 173 | trim | function | Deletes unused stdlib, metadata and platform extras to shrink the runtime. |
| 235 | assertNoBrokenSymlinks | function | Walks the tree and throws, naming each dangling symlink, before signing runs. |

#### scripts/make-icons.mjs

Runs the Pillow-based make-icons.py generator with whichever Python 3 is installed.

_No function, method, class, or arrow declarations (top-level script only)._

#### scripts/measure.mjs

Measures startup time, RSS and CPU of the packaged macOS app over CDP.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 36 | sleep | arrow | Promise-based delay helper used between samples. |
| 37 | mb | arrow | Converts kilobytes to megabytes for display. |
| 47 | cpuSeconds | function | Parses a `ps` cputime string (`MM:SS` or `HH:MM:SS`) into seconds. |
| 54 | readProcesses | function | Runs `ps` and parses pid, ppid, RSS, cputime and command for every process. |
| 71 | snapshot | function | Expands the app's process tree from a main pid and sums RSS across it. |
| 92 | roleOf | function | Classifies a process command line as renderer, gpu, utility, main or helper. |
| 102 | describe | function | Formats each process as `role:NMB` for the console output. |
| 113 | sample | function | Samples RSS and per-PID CPU deltas over a window and prints per-phase numbers. |
| 167 | connect | function | Opens the CDP WebSocket and returns a `Runtime.evaluate` wrapper plus the socket. |
| 183 | connect.evaluate | arrow | Sends a CDP evaluation request and resolves with its returned value. |
| 201 | launch | function | Launches the app with a debug port and waits for the CDP page, shell and home cards. |
| 242 | quit | function | Sends SIGTERM and waits for exit, with a timeout fallback. |
| 252 | activate | function | Brings Viby to the front via osascript so macOS does not throttle it. |
| 262 | bundleReport | function | Reports raw and gzip sizes for the built renderer JS and CSS assets. |

#### scripts/update-manifest.mjs

Generates an Ed25519 update keypair and signs release manifests for installers.

| Line | Symbol | Kind | Role |
|---:|---|---|---|
| 24 | manifestPayload | function | Builds the canonical `version` plus sorted `name hash` payload that main verifies. |
| 31 | signManifest | function | Signs the manifest payload with the given PEM key and returns base64. |
| 38 | sha256 | function | Hashes an installer file and returns its hex digest. |
| 42 | generate | function | Creates the keypair, pins the public key into src/main/update-key.ts and writes the private key. |
| 88 | signRelease | function | Hashes matching installers in the given directory and writes the signed update-manifest.json. |
| 111 | main | function | Dispatches the `generate` and `sign` subcommands, else prints usage and exits. |

### 12.7 Completeness and maintenance

The map was generated by a TypeScript AST pass over `src/main`, `src/preload`,
`src/renderer`, `src/shared` and `scripts`, then reviewed file by file. It covers
1,050 symbols; constructors, getters and the preload `window.viby` object arrows are
included even where the extractor would miss them. The Svelte sections intentionally
cover script-level helpers only; templates and styles are described in the system
sections above.

When adding or renaming a function, update this map if the change is structural. For
small local helpers, the architecture's file/module map is usually enough; keep the
roles accurate rather than exhaustive about every branch.

## 13. Invariants worth protecting

1. One runtime dependency (`electron-updater`); new dependencies need a strong
   reason.
2. The renderer never gets Node or filesystem access and cannot make arbitrary
   network requests; main supplies image/media URLs and owns API calls.
3. One `<audio>` element and one decode path.
4. Player position/ui/media-session updates stay at 1 Hz unless a user action
   requires an immediate sync.
5. Cache and downloads are bounded/reference-counted; explicit downloads are
   never auto-evicted.
6. The loaded track is never unlinked, even while paused.
7. Local media paths are contained under userData; fetches that accept external
   URLs or return user content are bounded and redirect-validated; updates fail
   closed.
8. Monochrome, restrained UI; title text navigates, row/card body plays; no
   unrequested controls.
9. Every new user-facing behavior needs matching coverage and an update to the
   TESTING.md impact map.
10. No ads, telemetry, accounts or bundled credentials.
