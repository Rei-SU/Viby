# Viby — Implementation Plan

A no-ads, no-subscription, no-quality-cap desktop music client. Ad-free by construction (we own the client), no artificial bitrate ceiling. Listening never requires an account; an optional account (later) backs up and syncs the library across devices.

Last updated: 2026-10-21 (rev 4)

---

## 1. Decisions log

Every decision below came from you, with the technical consequence I derived from it.

| # | Decision | Your answer | Consequence |
|---|---|---|---|
| 1 | Platform | Electron desktop app, ~400MB RAM ceiling acceptable, optimize hard | Main + renderer + GPU processes as one budget. No native code needed. |
| 2 | Catalog | YouTube Music via InnerTube | Free, huge catalog, unofficial → breakage risk is a first-class design concern |
| 3 | Stream resolution | Bundle `yt-dlp` | Handles signature deciphering + format selection; must live outside the app bundle so it can self-update |
| 4 | Local data | Stream + smart auto-cache | Bounded LRU cache; cached tracks play offline and instantly |
| 5 | Cache cap | 1GB default | ~300 tracks at 128–256kbps. Configurable in settings. |
| 6 | v1 features | Playlists, queue, favorites, history | A real library, not a search box |
| 7 | Import | Paste share URLs, no credentials, ever | Spotify via embed JSON + anonymous token; Apple Music via share-page JSON; **zero accounts required from you** |
| 8 | Import conflicts | Auto-match + review screen | No silent wrong-version imports |
| 9 | Unresolvable tracks | Skip + notify | Simple, honest |
| 10 | Charts | Global only | One less variable, no region config |
| 11 | Language | English only | No i18n layer, no RTL work in v1 |
| 12 | Playback auth | Anonymous, no credentials stored | Playback needs no login and stores no credentials. The optional account layer (later) is separate. |
| 13 | Lyrics | Layered fallback chain | lrclib → YouTube timedtext → plain text, all cached |
| 14 | Shell | Slim sidebar + art-forward heroes | Apple Music feel, still navigable |
| 15 | OS integration | Media keys + Now Playing, no tray/mini-player | `navigator.mediaSession` — no native code |
| 16 | Quality | User-selectable, default best, **never auto-downgrade** | Honour the setting exactly; buffer rather than reduce bitrate |
| 17 | Delivery | Auto-update via GitHub Releases | Windows: real auto-update. macOS: notify + one-click download (see §2.1) |
| 18 | Distribution | Me + a few friends | Installers, first-run setup, graceful upstream failure |
| 19 | Name | Viby | Bundle ID, installers, window title |
| 20 | Deferred | No EQ, gapless, crossfade, sleep timer, scrobbling, Discord, stats, sync, mobile | Kept out of v1 deliberately; accounts/sync and mobile are planned post-v1, not abandoned. |
| 21 | Phase order | Skip the standalone spike, start on the real player | P1's first task *is* the resolver proof — see §9 |
| 22 | Front door | Home + Search are the app; links are only for import | Search/browse shipped before anything link-shaped. The paste box moved into an explicit Import tab. |
| 23 | Player-client rotation | Don't pin clients; let `yt-dlp` choose, pin only as fallback | Measured 2026-10-18: every pinned set was SABR-only or failed. See §2.4. |
| 24 | Accounts (later) | Optional, local-first, for backup and sync | Never a prerequisite for listening or the local library. Built only after the core is polished, and designed alongside the planned mobile client. See §9 P6 and §10. |
| 25 | Offline & downloads | Explicit downloads + a first-class offline mode; cache stays invisible | Downloads live in app-managed storage, are never auto-evicted, and belong to the user. Offline mode is automatic with a manual override. See §17. |

## 2. Reality checks that shaped the design

Five assumptions that "obviously work" in most music-app plans do not. Verified against upstream docs and working projects, not guessed.

**2.1 — macOS auto-update requires code signing.** Squirrel.Mac refuses to update an unsigned app; Electron's own docs state it as a hard requirement. Auto-update on macOS is therefore not achievable at $0. Windows NSIS auto-update works unsigned.

**2.2 — Media keys must go through `navigator.mediaSession`.** Electron's `globalShortcut` has a long-standing broken-on-macOS bug for media keys, while `mediaSession` is a standard Chromium feature that populates macOS Now Playing and Windows SMTC with zero native code.

**2.3 — `yt-dlp -U` only works on a writable release binary.** The copy inside `Viby.app/Contents/Resources` is not writable and modifying it breaks the bundle signature, so the binary is copied to user data on first run and updated there.

**2.3a — The macOS PyInstaller build is unusable here; the zipapp is not.** Measured on this machine, with the network verified at 0.23s to first byte:

| Runner | `--version` | Full resolve |
|---|---|---|
| `yt-dlp_macos` (37MB PyInstaller, what the app shipped first) | **25–45s** | 34–70s |
| zipapp (3MB) under Python 3.14 | 1.9s | 4.7s |
| zipapp **extracted once** (keeps `__pycache__`) | **0.6s** | **2.9s** |

`spctl -a` **rejects** the PyInstaller binary (ad-hoc signed), so macOS re-assesses it on every launch — the whole 25–45s is Gatekeeper, not YouTube. The app now provisions the zipapp, unpacks it into `userData/bin/yt-dlp-src/`, and runs it with the discovered Python. The PyInstaller binary remains only as a fallback for Windows and for machines with no Python.

**2.4 — YouTube enforces PO tokens / SABR on stream URLs, and which clients work changes.** GVS (streaming) requests require a PO token for most clients, and several token-exempt clients now return SABR-only formats with no direct URL at all. This is the project's biggest risk. See R1.

*Measured 2026-10-18, yt-dlp 2026.08.19, macOS 15.7.7 (Apple Silicon-era Intel), on one track:*

| Client selection | Result |
|---|---|
| `android_vr,tv_simply,ios` (the original guess) | exit 0, but **0 audio formats with a URL** — SABR only |
| `tv` | error: "The page needs to be reloaded." |
| `web_safari`, `mweb`, `web`, `ios,web_safari` | error: "Requested format is not available." |
| **no `--extractor-args` at all (yt-dlp's default)** | **48 formats, 5 progressive HTTPS audio-only, best `m4a`/`mp4a.40.2` 130kbps** |

Two conclusions, both now baked into `src/main/ytdlp/resolver.ts`:

1. **Pinning clients is currently harmful.** The default multi-client selection is what works, so it is tried first and pinning is only a fallback. yt-dlp's maintainers track YouTube's client behaviour release by release; our hardcoded list cannot.
2. **Segmented formats are unusable here.** The default response also offers `m3u8_native` audio. Chromium — and therefore Electron — cannot play HLS in an `<audio>` element, so `parseInfo` accepts only `protocol: 'https'|'http'` formats and otherwise raises `NoDirectUrlError`, which triggers download-to-cache. Without that filter, a working resolve would have looked like a playback bug.

Anonymous playback works today with no PO token and no cookies. This is a baseline, not a guarantee, and the pinning fallbacks in `CLIENT_SETS` are the first thing to tune when it breaks.

**2.5 — Spotify needs no account after all.** `open.spotify.com/embed/playlist/{id}` ships the track list as `__NEXT_DATA__` JSON to anonymous visitors, and an anonymous token can be bootstrapped from Spotify's own pages to page through playlists longer than the embed limit. Multiple independent working projects confirm both paths. No credential, no Premium, no dev app.

## 3. Architecture

Three processes, strict separation, minimal IPC surface.

```
┌─────────────────────────── Electron main (Node) ───────────────────────────┐
│  window/lifecycle   IPC router   settings   logger   updater                │
│                                                                              │
│  ┌── innertube/ ──────────┐  ┌── ytdlp/ ──────────────────────────────┐     │
│  │ catalog: search,       │  │ binary provisioning + self-update      │     │
│  │ browse, charts,        │  │ resolve stream URL (JSON)              │     │
│  │ album/artist/playlist  │  │ download-to-cache (fallback path)      │     │
│  └────────────────────────┘  └────────────────────────────────────────┘     │
│                                                                              │
│  ┌── library/ ────────────┐  ┌── cache/ ────────┐  ┌── lyrics/ ──────────┐  │
│  │ playlists, favorites,  │  │ audio LRU (1GB)  │  │ lrclib → timedtext  │  │
│  │ history, settings      │  │ art LRU (200MB)  │  │ → plain, all cached │  │
│  └────────────────────────┘  │ policy + eviction│  └─────────────────────┘  │
│                              └──────────────────┘                            │
│  ┌── import/ ────────────────────────────────────────────────────────────┐  │
│  │ ytmusic │ deezer │ soundcloud │ spotify │ applemusic │ matcher       │  │
│  └───────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ typed, validated IPC (contextBridge, no Node in renderer)
        ▼
┌────────────────────────── Renderer (Chromium) ──────────────────────────────┐
│  Svelte 5 + Vite          single <audio> element      navigator.mediaSession│
│  player store (runes)     lyrics view                 virtualized lists     │
│  routes: Home Search Library Playlist Album Artist Charts Settings          │
│  components: PlayerBar, Queue, Cover, VirtualList, Lyrics, ImportReview     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why the catalog/stream split.** InnerTube provides rich music metadata (albums, artists, charts, continuations) that `yt-dlp` cannot; `yt-dlp` provides reliable stream URLs that raw InnerTube player calls increasingly cannot. Each does what it is good at.

### Data flow: playing a track

1. Renderer requests `player.resolve(trackIdOrUrl)`.
2. Main checks the audio cache. **Hit** → returns a local file path, instant play.
3. **Miss** → `yt-dlp -J` resolves a direct audio URL (default client selection; see §2.4). This is the only slow step (~2.9s cold), so it is moved *before* the click wherever intent is visible: hover, the first rows of a list, the next queue track, the top of Recently played.
4. Renderer sets `audio.src` and plays.
5. Background: if the track passes the cache-worthiness test (§6), `yt-dlp` downloads it so the next play is a hit.
6. Format URLs are IP-bound and expire (~6h). A 403 triggers one transparent re-resolve, then a download-to-cache fallback.

## 4. Tech stack

Lean on purpose. Every dependency is justified against the RAM/CPU budget.

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Your call; mature packaging and updater story |
| Main language | TypeScript on Node | Shared types with renderer; no second language to build |
| Renderer framework | **Svelte 5** | Compiles away — no virtual DOM, minimal runtime, lowest idle CPU of the mainstream options |
| Bundler | Vite + electron-vite | Fast HMR, small renderer bundles, one config for all three processes |
| Persistence | Atomic JSON stores | `node:sqlite` was evaluated and rejected: Electron 37 ships Node 22 where it needs `--experimental-sqlite`. The stores are small (favourites, history, playlists, settings), so synchronous temp-file + rename writes are simpler, crash-safe and dependency-free. |
| Audio | Single `<audio>` + Chromium decoder | Native decode = no extra CPU; `mediaSession` gives OS integration free |
| Resolution | Bundled `yt-dlp` (+ PO-token provider) | §2.3, §2.4 |
| Lyrics | lrclib.net (no key, CORS-enabled) | Verified free, no registration |
| Packaging | electron-builder + electron-updater | NSIS on Windows, DMG/zip on macOS |

**Deliberately not used:** React/Redux (runtime cost buys nothing here), any UI kit, Prisma/TypeORM, `better-sqlite3` (native rebuild risk for no benefit over `node:sqlite`), Web Audio graph (adds CPU until an EQ exists), `hls.js` (extra decode path), Tailwind (a handful of CSS custom properties is lighter).

**Runtime dependencies: exactly one.** `electron-updater`. Everything else is dev-time.

## 5. Feature specification

### 5.1 Playback (core)
- Play/pause, next/previous, seek, volume, mute, shuffle, repeat (off/all/one).
- Queue: add next, add to queue, reorder, remove, "clear upcoming".
- Resume where you left off on relaunch; restore queue.
- Sleep prevention while playing (Electron `powerSaveBlocker`).
- Media keys + OS Now Playing via `mediaSession`, with artwork.
- Settings: quality (best available / data saver ~64kbps, honoured exactly — no auto-downgrade), autoplay, cache cap and clear cache.
- On a slow network: buffer, never silently reduce quality. If it can't keep up we tell you, we don't decide for you.

### 5.2 Search
- Instant search, 250ms debounce, in-flight cancellation (stale responses dropped by request sequence number).
- Filters: songs, albums, artists, playlists. Charts live in Browse, not search.
- Results virtualized; artwork lazy-loaded with a low-res placeholder.
- Keyboard: `/` focuses search, `↑/↓` navigate, `Enter` plays, `Shift+Enter` queues.

### 5.3 Browse & categories
- Global charts (top songs, top albums).
- Moods & genres from YT Music's Explore surface, drilled into playlists.
- Home shelves: recently played, favorites, your playlists, imported playlists.

### 5.4 Library
- **Favorites** and **playlists** are local-first and never vanish when upstream changes. They stay on the machine by default; optional accounts (later) back them up and sync them across devices.
- **History**: every played track with timestamp and completion ratio; feeds "recently played" and lets the cache policy promote repeatedly-played tracks.
- Playlist cover = 4-up mosaic from tracks, or user-picked art.
- Every track row: play, queue-next, add to playlist, favorite, go to album, go to artist.

### 5.5 Lyrics
Layered, in this order, each result cached permanently:
1. `lrclib /api/get-cached` — internal DB only, fast, no external calls.
2. `lrclib /api/get` — wider search, slower, may hit external sources.
3. `lrclib /api/search` with title/artist, best-fuzzy match.
4. YouTube timedtext via our existing extractor (covers tracks lrclib lacks).
5. Plain unsynced lyrics, if that's all lrclib has.

Duration is included in the lrclib signature (±2s tolerance) because it sharply improves match accuracy. Synced lyrics get auto-scroll with the active line pinned and click-to-seek on any line. All requests send an identifying `User-Agent`, as lrclib asks.

### 5.6 Playlist import — no accounts, no credentials, no exceptions

| Service | Method | Fragility |
|---|---|---|
| YouTube Music / YouTube | Resolver we already have | Low |
| Deezer | Public API, no key | Low |
| Spotify | Embed-page `__NEXT_DATA__` JSON; anonymous token bootstrap for playlists past the embed limit | Medium |
| SoundCloud | Extract `client_id` from the web player | Medium |
| Apple Music | Share-page embedded JSON (no free official API exists) | High |
| Any | Paste plain `Artist - Title` lines, or drop a CSV | None |

The plain-text and CSV paths exist so that **no single company's decision can make importing impossible.** They are the floor, not the fallback of last resort.

**Matcher behaviour** (#8): exact title+artist match on YouTube Music search → auto-accept. Low confidence (fuzzy-only match, duration mismatch >10s, or several close candidates) → the review screen shows side-by-side candidates with artist and duration, and lets you pick, skip, or accept as-is. Nothing is silently wrong. Album-level imports match the whole album, which is far more accurate than track-by-track.

### 5.7 Not in v1
Equalizer, gapless, crossfade, sleep timer, scrobbling, Discord presence, mini-player, tray, listening stats, device sync, i18n, mobile, local file playback. Each is a clean addition later; none blocks the core. Accounts and cross-device sync are also post-v1: local-first stays the default, and listening never requires signing in.

## 6. Performance budget

The budget is a hard constraint, not an aspiration. If a change breaks it, the change loses.

| Metric | Target | How it's measured |
|---|---|---|
| Idle RAM (main + renderer + GPU) | **< 400MB** | Electron process list, sampled on a release build |
| Idle CPU | < 1% | `ps` sampling 60s after load with playback paused |
| CPU while playing | < 5% | Same, decoding audio |
| Cold start to interactive | < 2.5s | Instrumented launch-time metric |
| Renderer bundle | < 400KB gzipped | Build output |
| Resolve → first audio | < 300ms cached, < 2.5s uncached | In-app timing log |
| Scrolling | 60fps with a 5,000-row playlist | DevTools performance trace |

**Measured 2026-10-18** (`tests/resolver.test.ts`): warm resolve **0ms** from memory and **0ms** from the persisted URL cache after a restart; cold resolve **2.9s**; process startup **0.6s**. The first version of this measured **25–45s** — see §2.3, it was the `yt-dlp` binary, not the network. Clicks on prefetched rows (the top of every list, the hovered row, the next track) are therefore effectively instant.

**Measured 2026-10-19 on the packaged x64 build** (`npm run measure`, Intel Mac, macOS 15.7.7). RSS is the sum across the Electron process tree; the physical footprint (`vmmap`) is shown because RSS counts shared framework pages once per process.

| State | Summed RSS | Physical footprint | CPU |
|---|---|---|---|
| Idle (Home) | 287–317 MB | ~239 MB | 0.13–0.19% |
| Playing, window frontmost | 313–366 MB | ~200–260 MB | **5.4–8.9%** of one core (renderer ~4%, GPU ~3%) |
| Playing, fully occluded | — | — | ~1.3% |
| Playing + lyrics | 291–377 MB | ~200–260 MB | **10–22%** (largest state) |
| Paused after playback | ~305 MB | — | 0.3–0.4% |

- **Startup:** shell 858–902 ms warm; 1.2–1.7 s on the first launch after a build. Home cards render in the same frame when the shelf cache is warm.
- **Bundle:** 255 KB JS + 50 KB CSS raw = **62 KB gzip**.
- **Soak:** +2 MB RSS over 2 minutes of playback, no leak.
- **Lyrics cost:** the panel's 32px `backdrop-filter` is the biggest GPU consumer. A clean cached-track test went from 12.9% to 10.3% CPU with the panel blur disabled; the dock/titlebar glass showed no measurable cost. The 5% playing target in §6 is therefore **not met on this Intel machine** while the window is visible — it sits at ~9% of one core. The UI is still well inside the RAM ceiling, and idle CPU is effectively zero.
- **Caveat:** CPU depends heavily on window visibility (macOS throttles an occluded window); samples were taken with the app frontmost via LaunchServices.

Techniques that get us there:
- **Virtualized lists everywhere.** Never render more than ~40 DOM rows regardless of playlist size. The single biggest win.
- **Bounded caches with real eviction.** Audio 1GB LRU, art 200MB LRU, eviction in main. Never unbounded.
- **Lazy everything.** Art at display size, placeholder first, `loading="lazy"`, off-screen rows never request art.
- **One decode path.** Chromium's audio pipeline. No Web Audio graph, no transcoding.
- **No background timers.** No polling, no interval UI refresh. Position updates come from `timeupdate`, only while the lyrics view is visible.
- **Svelte compile-time reactivity** instead of a runtime reconciler.
- **Renderer stays dumb.** No catalog logic, no caching, no parsing — it renders and requests.
- **`yt-dlp` concurrency capped at 2**, idle-shutdown so no process lingers after a resolve.
- Package hygiene: no devtools in release, tree-shaken imports, no moment/lodash-class dependencies.

Cache-worthiness rule (keeps the cache useful instead of full): a track is cached when favourited, in your own playlist, played past 50%, or played twice. One-off exploration streams and leaves nothing behind.

## 7. Risk register

| # | Risk | Impact | Mitigation | Residual |
|---|---|---|---|---|
| R1 | YouTube PO-token / SABR enforcement blocks anonymous stream URLs | Playback fails for affected tracks | Prefer `yt-dlp`'s default client selection (measured best on 2026-10-18); pin clients only as fallback; accept `https` progressive formats only and fall back to download-to-cache for SABR-only tracks; bundle the `bgutil` PO-token provider so tokens are generated locally; keep `yt-dlp` auto-updating; **break-glass**: optional cookie import in Advanced settings | Medium-high. **Verified working 2026-10-18** with no PO token and no cookies (see §2.4) — but only via the default client selection, and `m3u8_native` audio had to be rejected to keep playback honest. Note the app's managed binary is **2026.08.19**, newer than the 2026.03.17 on `PATH`. Expect occasional multi-day windows needing a plugin update — the provider slot in `resources/yt-dlp-plugins/` is pre-wired for exactly that. Still the single biggest existential risk. |
| R2 | InnerTube constants (API key, client version) rotate | Search/browse errors | All constants in one patchable config file; fall back to `yt-dlp` metadata for search; overridable without a new build | Low |
| R3 | IP rate-limiting / bot checks from heavy use | Throttled or blocked | Aggressive caching (2h URL cache, bounded audio cache), a resolve only when playback needs one, prefetch limited to the single next track, polite user agent, request pacing with exponential backoff, concurrency cap | Low for personal use |
| R4 | macOS auto-update impossible unsigned | No silent updates on your main machine | Windows gets true in-app auto-update; macOS checks GitHub Releases and shows a prominent one-click download. Flipping to signed later enables silent macOS updates with no code change. | Accepted |
| R5 | Apple Music import depends on scraping | Import breaks | Plain-text/CSV import always available | Accepted |
| R6 | Spotify embed truncates long playlists | Partial import | Anonymous-token bootstrap pages past the limit; the review screen shows exactly how many tracks were found, and CSV/plain-text is always there | Low |
| R7 | SoundCloud `client_id` rotation | Import breaks | Re-extract from the web player JS on failure; plain-text fallback | Low |
| R8 | `electron-builder` requires a signing key for update manifests | Release pipeline fails | Generate a free Ed25519 update-manifest keypair once, store in CI secrets | None |
| R9 | ~~`safeStorage` prompts on unsigned builds~~ | — | **Eliminated** — no credentials are stored anywhere | None |
| R10 | Electron RAM creep | Breaks the core requirement | The budget table is enforced; dependency additions must be justified. Runtime deps: one. | Low |
| R11 | Legal / ToS | Personal risk | Personal use + a few friends, no public distribution, no monetisation, no DRM circumvention; `yt-dlp` is Unlicense. Public release would invite DMCA pressure — re-plan then. | Accepted, your call |

## 8. Repository layout

```
viby/
├── package.json
├── electron-builder.yml
├── electron.vite.config.ts
├── PLAN.md
├── resources/
│   ├── bin/                      # yt-dlp copied to userData on first run
│   ├── yt-dlp-plugins/           # PO-token provider (R1)
│   └── icons/
├── src/
│   ├── main/
│   │   ├── index.ts              # lifecycle, single-instance lock, powerSaveBlocker
│   │   ├── windows.ts
│   │   ├── ipc.ts                # typed channels + validation
│   │   ├── settings.ts
│   │   ├── json-store.ts         # tiny atomic JSON store
│   │   ├── library.ts            # favorites + history
│   │   ├── logger.ts
│   │   ├── updater.ts            # auto-update (Win) / notify (mac)
│   │   ├── innertube/            # P2 — catalog (shipped for search/browse)
│   │   │   ├── constants.ts      # single place to patch (R2)
│   │   │   ├── parse.ts          # tolerant, Electron-free, unit-testable
│   │   │   └── client.ts
│   ├── tests/                    # resolver + InnerTube tests, outside Electron
│   │   ├── electron-stub.ts
│   │   ├── ytdlp/
│   │   │   ├── binary.ts         # provision + self-update
│   │   │   └── resolver.ts       # JSON → stream URL, client rotation
│   │   ├── cache/
│   │   │   ├── audio.ts          # LRU + eviction
│   │   │   └── policy.ts
│   │   ├── lyrics/               # P3
│   │   └── import/               # P4
│   ├── preload/index.ts          # contextBridge, the only exposed API
│   ├── shared/
│   │   ├── types.ts
│   │   └── ipc.ts                # one source of truth for channels
│   └── renderer/
│       ├── index.html
│       ├── main.ts
│       ├── App.svelte
│       ├── lib/api.ts            # typed `window.viby`
│       ├── lib/player.svelte.ts  # audio element + mediaSession + state
│       ├── components/
│       └── styles/
└── tests/
```

## 9. Delivery phases

**P1 — Playback core. Built, verified, awaiting your play test.**
Resolver proof first, by design (your call to skip the standalone spike): the very first thing built is `yt-dlp` provisioning plus single-track resolve-and-play, which is exactly the thing the spike would have tested. If PO tokens defeat anonymous playback, we find out in the first hours rather than after the UI exists.
Then: player bar with seek/volume/shuffle/repeat, queue, media keys, Now Playing, settings, cache with eviction, history and favorites.

*Built and verified:* `yt-dlp` provisioning into userData (with self-update), client-rotation resolver with a S2 concurrency cap, resolve-URL cache with 2h TTL, bounded 1GB LRU audio cache with eviction, download-to-cache fallback for SABR-only tracks, background caching driven by the cache-worthiness rule, local-first favorites and history, JSON settings, a privileged `viby-media://` scheme for serving cached audio without weakening `webSecurity`, and a Svelte 5 player with queue, seek, volume, shuffle, repeat, and full `mediaSession` integration.
*Typecheck and build are clean; renderer bundle 181KB raw (~55KB gzipped).*

**P1.5 — Crash fix and honest failures. Done.**
`yt-dlp` prints the literal string `null` to stdout with exit code 1 when extraction fails; we treated that as data and crashed in `parseTrack` with `Cannot read properties of null (reading 'id')`, discarding the real reason in stderr. Now every failure path is validated (`code !== 0 || !trimmed || trimmed === 'null'`), mapped to a readable message (`unavailable`, `botcheck`, `playlist`, `cancelled`, `unknown`), and shown in the UI. A resolve can also be **cancelled**, so a slow track can no longer hold the window for two minutes. Regression tests: `tests/resolver.test.ts`.

**P2 — Search + browse + library. Shipped.**
Shipped: the InnerTube catalog client (`WEB_REMIX`, one constants file for R2), tolerant cross-container response parsing, search with filters (All/Songs/Albums/Artists/Playlists), home shelves, global charts, album/artist/playlist detail pages, and click-to-play straight from any of them.
Shipped after the first pass: likes, playlists and history built on the atomic JSON stores (not `node:sqlite`), collection pages, the add-to-playlist picker, and artist discography tabs.

*Acceptance:* find a song, play it, favourite it, build a playlist, restart, everything is still there. **Met.**

**P3 — Lyrics. Shipped.**
Full fallback chain, synced auto-scroll, click-to-seek, permanent caching.

*Acceptance:* a synced track highlights the correct line throughout playback and still works offline from cache.

**P4 — Browse + import. Shipped.** Link-only import for Spotify (anonymous web-player GraphQL, public playlists), Apple Music (page JSON), Deezer (public API), YouTube Music (100-row continuations) and SoundCloud (scraped web-player client id). The matcher scores title/artist/duration, auto-accepts exact matches, reviews the rest, follows progress/cancel and creates the playlist in source order. YouTube playlists use their exact ids (no search). `ImportView` is the single paste-a-link surface. Research below:

*Acceptance:* paste a public Spotify/Apple Music/Deezer/YouTube Music/SoundCloud playlist; the source
appears, tracks are matched or visibly flagged, and the playlist is created in source order. Verified:
Today's Top Hits (50) → 48 auto / 2 review / 0 missing; a 951-track YouTube playlist imports in ~11s.
Not in this slice: moods/genres browsing, private/collaborative Spotify playlists, Liked Songs. The
CSV/text floor was dropped by decision (link-only interaction).

**P5 — Ship. Partially done.**
Installers (DMG + NSIS), auto-update on Windows, notify-and-download on macOS, first-run setup, error states for every upstream failure mode, release pipeline.

*Acceptance:* a friend installs Viby from a DMG on their own Mac, imports a playlist, and plays music without you touching their machine.

**P6 — Accounts and sync. Deferred on purpose.**
Not started. Begins only once P5 is done and the core experience is fully polished — playback correct, the look and feel settled, and no open fundamentals. Until then the profile avatar stays a placeholder.

Scope: optional accounts with end-to-end encrypted backup and sync of favorites, playlists, history and settings across devices, designed alongside the planned Android client. Local-first remains the source of truth; signed-out use is unchanged. Sync must support export, account deletion and transparent conflict handling.

*Acceptance:* two machines signed into the same account converge on the same library after an offline edit, and signing out leaves a complete, usable local library. Export and account deletion need no support ticket.

**P7 — Offline mode and downloads. Planned.**
The full specification is §17. Three shippable slices: connectivity + offline shell first, then the download engine and visible offline library, then playlists/liked collections and artwork/polish.

*Acceptance:* with the network off, the app opens into an offline Home showing downloaded music; a downloaded album plays end-to-end offline after a relaunch; undownloaded cached tracks still play silently; uncached playback fails fast with a human message; deleting a playlist removes only downloads no other source still needs.

## 10. Open items

Settled: cache cap (1GB), quality policy (never downgrade), Spotify (no credentials), phase order (skip spike, straight to P1), language (English), charts (global), accounts (optional, local-first, post-v1 — see §9 P6).

Still open, none blocking:
1. ~~**Quality setting options**~~ — settled: best available / data saver (~64kbps).
2. **Queue behaviour on repeat-one** — restart the track, or stop after the current play? Default: restart.
3. **History retention** — keep everything, or cap at the last 5,000 plays?

## 11. Build notes and gotchas

Things that cost time, recorded so they don't cost it twice.

- **npm 11 gates install scripts.** `electron` and `esbuild` postinstalls are blocked by default, so Electron silently has no binary and nothing runs. Fix: `npm install-scripts approve electron esbuild`. Expect this on any fresh clone.
- **No native modules, on purpose.** `better-sqlite3` would need a node-gyp rebuild, and this machine runs Python 3.14, which toolchains lag behind. `node:sqlite` (inside Node 22+) gives the same capability with zero rebuild risk and one less runtime dependency. P1 therefore uses atomic JSON stores.
- **Cached audio is served over `viby-media://`, not `file://`.** Chromium blocks `file://` media from an http origin, and the usual workaround is disabling `webSecurity`. Registering a privileged custom scheme avoids that trade entirely — every security flag stays on.
- **Runtime dependencies: exactly one** (`electron-updater`). Everything else is dev-time, which is what keeps the RAM budget honest.
- **Media keys route through `mediaSession`, not `globalShortcut`.** `globalShortcut` media-key registration is broken on macOS (a long-standing Electron bug); everything goes through `navigator.mediaSession`, which also gives us Now Playing and Windows SMTC for free.
- **The dev log** lives at `/private/var/folders/kl/.../T/opencode/viby-dev.log` while `npm run dev` is running.
- **`yt-dlp` exits 1 and prints the string `null` on stdout when a video fails.** Checking `code !== 0 && !stdout.trim()` is not enough — `"null"` is non-empty, so it parses to `null` and crashes the caller. Always treat `code !== 0`, empty output, **or literal `null`** as failure, and read the reason from stderr.
- **Chromium cannot play HLS in an `<audio>` element.** `yt-dlp` happily offers `m3u8_native` audio at a competitive bitrate; feeding it to the player looks exactly like a broken stream. Filter to `protocol: 'https'|'http'` and fall back to download-to-cache otherwise.
- **Don't pin `--extractor-args youtube:player_client=…`.** See §2.4: as of 2026-10-18 it is what breaks playback, not what fixes it.
- **Profile process startup before blaming the network.** The first "playback is slow" diagnosis blamed YouTube; `yt-dlp --version` alone took 25–45s while `curl` reached YouTube in 0.23s. If something feels slow, time the empty case first.
- **`python3 -S` breaks HTTPS in yt-dlp** (`CERTIFICATE_VERIFY_FAILED`, because `site` is what sets up certificate paths on the macOS framework build). It saves 300ms of startup and costs you all network access — don't.
- **Playback speed comes from prefetching, not from a faster resolver.** Catalog metadata is instant (InnerTube), so the app resolves stream URLs ahead of the click: the first few rows of every list, the hovered row, the next queue track, and the top of Recently played. The URL cache is persisted to disk for two hours, so restarts do not repeat work.
- **Resolve latency breakdown (this machine):** ~0.6s Python startup + ~2.3s yt-dlp network work = ~2.9s cold. Warm is 0ms, so the UX target is met by "resolve before the user asks".
- **Tests run outside Electron** by aliasing `electron` to a stub, which makes the resolver testable without a GUI:
  ```
  npx esbuild tests/resolver.test.ts --bundle --platform=node --format=esm \
    --alias:@shared=./src/shared --alias:electron=./tests/electron-stub.ts \
    --outfile=/tmp/resolver.mjs && node /tmp/resolver.mjs
  npx esbuild tests/innertube.test.ts --bundle --platform=node --format=esm \
    --alias:@shared=./src/shared --outfile=/tmp/it.mjs && node /tmp/it.mjs
  ```

## 12. Bug log

Defects found by exercising real responses and real timing, not by reading the code. Each one has a regression check in `tests/`.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B1 | No artwork on any Home/Charts card | Carousel items store art under `thumbnailRenderer`, list rows under `thumbnail`; the parser only knew the second | `bestThumbnail` checks both |
| B2 | Rows downloading 38–113KB images | Every URL was rewritten to `w544-h544` regardless of display size | Rewrite to `w360-h360`; `Cover` falls back to a placeholder on error |
| B3 | Recently played showed no art | `HistoryEntry` never stored a thumbnail | Added `thumbnail` to history, written on every play |
| B4 | Whole "Videos" carousels on artist pages were dead clicks | Video cards carry `navigationEndpoint.watchEndpoint`, not `browseEndpoint` | Read the watch endpoint; artist pages went from 5 to 25 playable items |
| B5 | Rows tagged "unknown" that opened nothing meaningful | Profiles and podcasts have no `pageType` | Infer kind from the subtitle prefix |
| B6 | A slow resolve could hijack playback from a newer one | No generation guard on `start()` | Monotonic `playToken`; stale results are dropped |
| B7 | Bogus "Playback problem: Cancelled." when switching tracks | The abort message was surfaced as an error | Cancel is silent; only real failures set `error` |
| B8 | Clearing the queue mid-resolve could start playing afterwards | `clearQueue` did not invalidate the pending resolve | Bumps the token and cancels the request |

Verified by test, not assumed: all five search filters return the right kinds, album pages expose their full track list (13 tracks on *Random Access Memories*), a 100-track playlist parses completely, every Home/Charts/search row has artwork, and every thumbnail URL returns HTTP 200.

### Round two (after the first play test)

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B9 | **No artwork anywhere**, while `curl` returned 200 for the same URLs | Google's image CDN answers **HTTP 429 + an HTML error page** when the `Referer` is a non-YouTube origin. Node and `curl` send no Referer; the browser always does. | `<meta name="referrer" content="no-referrer">` in `index.html` — one fix that covers every `<img>`; verified 35 loaded / 0 failed |
| B10 | Player said "Nothing playing" while music played on by itself | Two mechanisms: a Vite hot-reload re-created the player module while the old `<audio>` element kept playing (orphaned from the UI), and `ended` could advance on a stale source | `import.meta.hot.dispose()` stops and clears the old element; `loadedId` guard means `ended` only advances the track that is actually loaded |

Diagnostics added while chasing these, both permanent and useful:
- Renderer console output is forwarded to the dev log (`windows.ts`), so a renderer failure is visible from the terminal.
- `VIBY_DEBUG_PORT=9222 npm run dev` exposes the DevTools protocol and `window.__viby` (dev only), and `node tests/drive.mjs` drives the *real* app: it checks rendered `<img>` elements and lets a track play to its end to prove auto-advance keeps the UI in sync. This is the only way to test behaviour that depends on a live audio element.

### Round three

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B11 | Recently played showed no artwork (and stayed that way) | Entries written before `HistoryEntry.thumbnail` existed have no art, and the renderer only had the history record to draw from | `history:list` backfills title/artist/thumbnail from `tracks.json`; `start()` also fills a missing thumbnail from the resolver result. Verified in the live DOM: 5 cards, 5 images, 0 broken |
| B12 | Dragging the scrubber restarted the song instead of seeking | `viby-media://` served cached audio through `net.fetch(file://)`, which returns a plain `200` with **no Range support**, so Chromium treated every cached track as unseekable (`seekable=[[0,0]]`). Setting `currentTime` was ignored/reset | The protocol handler now answers `206 Partial Content` with `Content-Range`, `Accept-Ranges` and `Content-Length`, streaming from `createReadStream(file, { start, end })`. Verified: `seekable=[[0,213.061]]`, seek(60) lands at 62s, same stream, no media error |

Lesson worth keeping: a media element that *plays* is not necessarily *seekable*. `player.diagnostics` now exposes `seekable` ranges and `audio.error.code`, and `tests/drive.mjs` asserts both.

### Round four — player and library behaviour sweep

New harness: `tests/behaviour.mjs` (with `tests/cdp.mjs`) drives the real player and checks queue editing, repeat modes, shuffle, favourites, history, the media session and the cache badge. Everything below was found by running it.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B13 | **The heart button did nothing, ever** | `library.json` contained `favorites: [null]`. `toggleFavorite` looks up with `data.favorites.findIndex((t) => t.id === …)`, so one malformed entry threw for every call. Nothing validated the stored shape, and `undefined` unshifted into an empty array serialises as `null`. | Validate on write (`isValidTrack`), **self-heal on read** (drop malformed entries and rewrite), same for history. Verified: click → saved + heart on; click again → removed |
| B14 | Heart still failed with a valid store | `api.favorites.toggle(track)` passed a **Svelte state proxy** over IPC → "An object could not be cloned" | The button sends a plain snapshot (`{ ...track }`) and logs failures instead of swallowing them |
| B15 | Previous track kept playing under the new title during a resolve (~2.5s) | `start()` replaced the title immediately but never paused the old audio | Pause before resolving; silence is honest, and it makes the resolve time visible |
| B16 | Volume slider wrote `settings.json` on every input event | No debounce on `settings.set` | 300ms debounce (`persistSettings`) |
| B17 | Lookahead prefetch wasted a resolve under shuffle / repeat-one | It warmed the sequential next track, which those modes ignore | Skip prefetch in both modes |

Verified behaviour (all passing): remove a later track, remove the current track, clear; repeat-one restarts; repeat-all wraps; shuffle stays in range and varies; favourites persist and the heart reflects them; pausing records history with a thumbnail; `mediaSession` publishes title/artist/artwork; cached streams show the badge.

### Round five — view state

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B18 | Searching, opening an artist, then going Back left the search page empty | Search state lived inside `SearchView`, which unmounts whenever a detail page opens | `lib/search.svelte.ts` owns query/filter/results; the component is a pure view |
| B19 | Every visit to Home/Charts/artist refetched and flashed a spinner | Component-local state with no cache | `lib/catalog-cache.svelte.ts` keeps shelves for the session and detail pages for 10 minutes |
| B20 | Back from a detail page always landed on the current tab, losing the path | `back()` just cleared the detail | Navigation keeps a small stack (artist → album → back → artist → back) |
| B21 | Scroll position reset on every navigation | Nothing remembered it | App keeps scroll offset per view, restored on the next frame |

Verified in the running app: type "daft punk" → 20 rows → click an artist → Back → query is still "daft punk", 20 rows, Songs chip still active.

### Round six — autoplay

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B22 | "Autoplay" continued with a random/unrelated track (including AI-generated uploads) | The queue *was* the list you clicked from. From search, that means "the next search result", which has no relation to what you played | Search queues only the clicked song; when a queue is exhausted, autoplay appends **YouTube Music's own radio queue** (`/next` with `playlistId=RDAMVM<videoId>`) |
| B23 | Autoplay had a ~2.5s silent gap at the seam | The radio queue was fetched only after the track ended | Radio is fetched while the last track is still playing, its first track's URL is prefetched, and the result is cached by seed |

Measured: radio returns **49 related tracks**, all playable, with artists and durations (80s pop for a Rick Astley seed). End-to-end: queue 1 → 26 and playback moved to "Take Me to Your Heart" — a related track, not a search sibling. The toggle ("Autoplay similar songs when the queue ends") lives in the Queue view and persists in settings.

### Round seven — what counts as a queue

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B24 | Playing a song from Recently played queued the rest of the history, so "next" was another old track | The recent rail was passed as a queue context, exactly like an album | History is not a playlist: a recent card queues **only that track**, and autoplay radio continues afterwards. Curated collections (album, playlist, Home/Charts shelf) still play as a queue. |

### Round eight — chrome language

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B25 | A banner announced "Resolving from YouTube… 12s" on every play, which made the app look like it was begging an upstream service to work | The status strip explained our plumbing instead of showing state | Removed. The play button itself becomes a spinner while a stream resolves; no copy mentions the dependency. Errors still explain themselves when something actually fails. |

### Round nine — song pages and player-bar links

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B26 | Artist name in the player bar was plain text | `artistId` only existed when a row's subtitle carried `pageType` metadata. Home carousels had no `parts` at all, and radio bylines omit the page type | `refId()` falls back to the browse-id prefix (`UC…` artist, `MPREb_…` album); `musicTwoRowItemRenderer` now returns parts too. Verified 49/49 radio and 20/20 Home songs carry artist ids |
| B27 | No song page; the player-bar title did nothing | Only album/artist pages existed | New `TrackView`: artwork, title, artist + album links, duration, Play/Pause, Add to queue, and **Related songs** (the radio queue). The player-bar title opens it; list rows still play on click, as elsewhere |

Verified in the running app: bar title → song page (heading matches), artist link present, 10 related songs rendered.

### Round ten — page identity

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B28 | Two different artists appeared to have the **same profile picture** | Artist pages borrowed the artwork of the track that linked to them (the only image we had). Nothing fetched the page's own header | `browse` now returns the page header (`musicImmersiveHeaderRenderer` / `musicResponsiveHeaderRenderer`) with the real photo, title and bio; DetailView renders that, and artist/album links no longer pass the song's cover |

Verified on a featuring track (*Instant Crush*): the row links to **Daft Punk** and **Julian Casablancas**; the pages now show different artwork (`lh3.googleusercontent.com/…`, 1080px vs `yt3.ggpht.com/…`, 2560px), correct headings and 25 / 11 tracks.

Freeze investigation: not reproducible. Ten navigations (song page, two artist pages, back twice) stayed responsive at 0% CPU; a fresh launch is idle. The earlier hang is most consistent with a hot-reload arriving mid-playback while the renderer was being edited (dev-only). Tooling to capture it if it recurs: `VIBY_DEBUG_PORT=9222 npm run dev` + `Debugger.pause`.

### Round eleven — always-linkable artists

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B29 | Artist name in the player bar was still plain text for some tracks | Tracks rebuilt from **history** (and from yt-dlp) have no browse id — history stored only title/artist/thumbnail, so `toTrack` had nothing to link | The artist is now always rendered as a link: if `artistId` is missing, `openArtist()` looks the name up once on click (`search(name, 'artists')`) and opens the first real artist page. History also stores `artistId` going forward, and its rows carry it |

Verified with an old history entry (`artistId: null`): the player bar rendered a `<button>` for "GLM-RST" and clicking it opened the artist page (12 tracks).

### Round twelve — self-healing playback

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B30 | "Playback problem: failed to load because no supported source was found" on *some* songs, which then played fine if you re-selected them or moved the scrubber | A cached file can be unusable (interrupted download, partial write, disk pressure). `recover()` had a branch that **gave up immediately for cached files** ("try clearing the cache"), and `start()` surfaced Chromium's raw `play()` rejection, so a transient source error became a visible failure | `recover()` now always re-resolves with `force` + `discardCache` (deletes the bad cached file), resumes at the current position, and retries at most twice per explicit load. Raw `play()` rejections are logged, not shown; only a failed recovery surfaces an error. Also fixed suffix byte-ranges (`bytes=-500`) in the `viby-media://` handler |

Reproduced deterministically by corrupting a cached file:

```
1s  kind=file    errorCode=4 (SRC_NOT_SUPPORTED)
3s  kind=remote  (cache entry discarded, fresh URL)
6s  playing, position 3, no error shown
```

## 13. Design system

The UI is built from a small set of decisions rather than per-component styling. Every screen inherits them.

**Surfaces (muted glass).** One ambient layer behind everything: two very soft radial washes (violet top-left, teal bottom-right) at 17–24% opacity, painted as CSS gradients — no blur filter, no images, no cost to scroll. Panels are translucent (`rgba(17,17,23,0.62)`) with `backdrop-filter: blur(26px) saturate(150%)`, a 1px `rgba(255,255,255,0.07)` hairline and a single inset top highlight. Only the sidebar, the player dock and Import panels are glass — restraint is what stops glassmorphism looking cheap.

**Palette.** Near-black base (`#08080b`), three text weights (`#f2f2f5` / `#9c9ca8` / `#686873`), one accent (`#a78bfa`, muted lavender) used only for state (playing row, active nav icon, primary action, progress fill). Red is reserved for real errors.

**Type.** System stack; 30px/640 page titles with -0.028em tracking, 15px/600 section headings, 13.5px body, 11.5px metadata. Tabular numerals for every duration.

**Shape & motion.** 22px panels, 16px cards, 12px controls, 999px pills. One easing (`cubic-bezier(0.22,1,0.36,1)`), 160ms, and `prefers-reduced-motion` disables the rest.

**Components.** `Icon.svelte` replaces every emoji with a 24px stroked glyph set. `PlayerBar` is a floating dock with an accent play button and a filled scrubber. `HomeView` cards lift 3px on hover with a play badge and a slight image dim. `TrackRow` shows a three-bar equaliser on the playing row and surfaces artist/album links on hover. Detail and song pages add an artwork bloom (`filter: blur(70px)`, 30% opacity) behind the header.

### Design revision — monochrome, flat, collapsible

- **No colour accent.** White is the accent: primary buttons are white with black glyphs, the playing row and active nav are plain white, the scrubber fills white, and the ambient wash is neutral (`rgba(255,255,255,0.045)`). Red remains for errors only.
- **No rounded panels.** Sidebar, titlebar and player dock are flush edge-to-edge with hairline dividers (`border-right` / `border-top`). Only content elements keep radii (cards 12px, rows 10px, controls 8px, actions pill).
- **Collapsible sidebar.** A titlebar button toggles 218px ⇄ 66px (icon rail) with a 220ms grid transition; the state persists in `localStorage` (`viby.sidebar`). Verified: default expanded, click → 66px + persisted, reload → collapsed.
- **Breathing room.** Dock height 84px, control column padding 8px, 9px gap to the scrubber; the primary play button is 38px with 6px side margins. Card play badges inset 11px.

### Round thirteen — the freeze, finally

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B31 | App froze (~100% CPU, unresponsive) when opening an artist page — "randomly" | `DetailView`'s `$effect` read `items` via `player.prefetchList(items, 2)` in its **cached** branch, making `items` an effect dependency. On a later **uncached** page the same effect wrote `items = []` (a fresh array each run), invalidating itself → infinite Svelte flush. It needed one prior artist visit to hold a cache entry, which is why it looked random | Nothing inside that effect reads `items` any more; prefetch stays in `load()`, outside tracking. Reproduced deterministically (stack: `flush_queued_effects → update_effect → internal_set` from the keyed-each update), then verified 12 artist navigations with no freeze |
| B32 | Playback paused when the window was behind another app (surfaced by the test suite) | Chromium suspends background media to save power: "play() interrupted because video-only background media was paused" | `backgroundThrottling: false` plus `disable-background-timer-throttling`, `disable-renderer-backgrounding`, `disable-backgrounding-occluded-windows` |
| B33 | `Cover`'s failure reset was effect-based | An `$effect` wrote the same state its `onerror` handler wrote — a latent ping-pong risk | Failure is derived from the failed URL (`failedSrc !== src`); no effect |

Also updated the drive harness for the redesigned markup (`.dock`, `.searchbox input`, icon-button `aria-label`).

### Round fourteen — real artist pages

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B34 | Every artist page looked like a flat list of songs — no discography | `browse` discarded the page's carousels; `DetailView` filtered everything to `kind === 'song'` | `browse` now returns the page's **shelves** too. Artist pages render *Top songs* + a carousel per shelf: **Albums**, **Singles & EPs**, Videos, Live performances, Featured on, Playlists by the artist, Fans might also like. Header shows `N albums · M singles & EPs`; "Play all" plays the top songs |

Albums and playlists still render as a flat track list. Carousels use a shared `MediaCard` (also used by Home), so the two surfaces cannot drift apart.

Verified against YouTube Music's own structure for Daft Punk: 8 shelves, 70 cards, with years on albums and `Single • 2005` on EPs.

### Artist page — audio only

Removed the **Videos**, **Live performances** and **Featured on** shelves from artist pages. They are watching surfaces or playlist filler, and they buried the actual discography. What remains is what a listener needs: *Top songs*, **Albums**, **Singles & EPs**, playlists by the artist, and similar artists. Verified live: sections are exactly `Top songs · Albums · Singles & EPs · Playlists by Daft Punk · Fans might also like`.

### Search from the titlebar (2026-10-20)

Search moved out of the page and into the **center of the titlebar**, with the chrome controls on the
left and a placeholder profile avatar on the right. The bar stays mounted on every page.

- Focusing the empty field shows **recent searches** (localStorage, last six, clearable).
- Typing fetches **Songs / Artists / Playlists** in parallel and shows the top five of each, updating
  each section as its request lands. Every section has **Show more**, which opens the full Search page
  already filtered to that category.
- **Enter** with nothing highlighted opens the full Search page; **Enter** on an arrow-key highlighted
  result opens it. A click starts songs immediately without leaving the page; artists and
  playlists open their pages. The footer exposes the same "All results" action. A suggested song is
  played **on its own**: what comes next is the radio autoplay seeded from that track, exactly like
  YouTube Music — never the rows around it in the results list.
- The Search page no longer owns a second input. Its header shows the query and the filter chips; the
  default filter is back to **All** (the Songs-first default was a bad call) so the detailed page can be
  designed properly next.
- `Cmd/Ctrl+K` focuses the bar. The bar is a no-drag island inside the draggable titlebar, and its
  panel sits above the lyrics panel. The panel's glass mirrors the lyrics panel exactly
  (`rgba(11,11,15,0.78)` + 32px blur + the same 300ms motion family). It mounts through a **portal
  to `<body>`**: nested under the titlebar's own `backdrop-filter`, the panel's backdrop sampling
  broke and the glass read lighter than the lyrics panel despite identical values.
- The profile avatar is a visual placeholder; clicking it says
  profiles are coming later.

### Browser-style navigation (2026-10-20)

Navigation moved out of the page and into the titlebar: the sidebar toggle is followed by **Back** and
**Forward** buttons with browser semantics. The history stack records detail, song, collection *and* tab
changes; new navigation clears the forward trail, and deleting a playlist drops the forward entry that
pointed at it. The in-page Back buttons were removed from artist/album/playlist/song pages.

The artist banner is now **full-bleed**: it meets the titlebar with zero top margin and spans the content
edge to edge with square corners, while the actions and track list keep the normal 28px gutter. The
existing inset shadow is unchanged. Verified at 0/0/0 (left/top/right) in the navigation e2e.

### Artist banner (2026-10-19)

Artist pages now use the artist header photo as a **wide banner** (230–320px, rounded, neutral top-to-bottom
gradient) instead of a circular profile picture. The artist name sits bottom-left with the monthly listener
count directly under it; **Play all** and the album/single counts sit below the banner. Album and playlist
heroes keep their square covers.

Monthly listeners come from YouTube Music's `musicImmersiveHeaderRenderer.monthlyListenerCount`
("71.8M monthly audience"), parsed to `71.8M` and labelled "monthly listeners". Artists whose page has no
count simply omit the line. Verified: Daft Punk shows **71.8M monthly listeners**; a small artist (DJT) still
gets the banner, with the line omitted.

### Artist discography — one rail, switchable

Five stacked carousels became **one rail with tabs**: `Albums` · `Singles & EPs` · `Playlists` · `Similar artists`. The selected tab is a white pill; switching remounts the rail so its horizontal scroll resets. Default is Albums. Top songs stay above as rows.

Verified: 4 tabs, exactly **1 rail**, and switching changes the content (`Random Access Memories (Drumless Edition)` → `GLBTM (Studio Outtakes)`).

### Quality indicator

A small tag sits between the cached badge and the volume controls: `AAC 130k` / `OPUS 132k`. It reports the **stream actually playing**, not the setting:

- codec derived from the container (`m4a` → AAC, `webm`/`opus` → OPUS, `mp3` → MP3)
- bitrate from the resolved format, or — for cached files, which carry no metadata — computed from `file size × 8 ÷ duration`
- tooltip adds the full detail: `OPUS · 131 kbps · cached on disk` vs `· streaming`

Verified both paths: cached file → `OPUS 131k`, remote stream → `OPUS 132k`; drive suite asserts the tag format.

## 14. Library (shipped)

**Data.** `library.json` now holds `favorites`, `history` and **`playlists`**. A playlist is `{ id, name, createdAt, updatedAt, tracks[] }`; tracks are the same `Track` objects used by the player, so a playlist entry can open its artist, show its cover and play without another lookup. Malformed entries are dropped on read and healed on write, same policy as favourites.

**Store fix.** `JsonStore` used to debounce writes by 250ms — a quit inside that window silently lost the last change. It now writes synchronously (temp file + rename, a few KB per change). That also removed the need for the player's settings debounce.

**UI.**
- New **Library** tab: *Liked songs* tile (with count), one tile per playlist (cover from its first track), and a *New playlist* tile that expands into an inline name field.
- **Collection page** for liked songs and each playlist: hero, Play all, Rename, Delete (two-step), track list with remove buttons, and Play all disabled when empty.
- **Add to playlist** on every track row: a library icon opens a single popover anchored to the row, listing playlists with counts plus "New playlist". One instance lives in the app root, so every surface (search, artist, album, song page) has it with no prop drilling.
- Deleting a playlist returns to the Library; removing a track from Liked songs unfavourites it.

**Verified.** Model test covers create/dedupe/remove/rename/delete, persistence across instances, and self-healing of `null` entries. Drive test creates a playlist, opens it, checks its row, and deletes it. The picker was exercised end to end: search → row button → pick playlist → track stored.

### Resume, row metadata, clickable artists

| # | Change |
|---|---|
| B35 | **Resume on launch.** `session.json` stores the current track, up to 100 queue entries, the index and the timestamp (throttled every 3s, plus on play/pause/ended/beforeunload). On launch the player restores the queue and track **paused** at that position; pressing play resolves and seeks to it. Verified: saved at 75s → restored at 78s paused → play resumed at 83s. |
| B36 | **Rows on collection pages lost the artwork** (album, playlist, single, liked, user playlists). The page already shows the cover; rows are now index · title · artist · album · plays · duration. Artist top songs keep artwork (each track is from a different release). |
| B37 | **Play counts and album links.** YouTube returns two extra columns on artist rows — "1.2B plays" and the album with a browse endpoint — which the parser dropped. Both are now parsed (`views` + an album part), and the play count moved out of the subtitle so it is not duplicated with the duration. |
| B38 | **Artist links in the queue.** The queue row was a `<button>`, so a nested artist link was invalid; it is now a proper row with a clickable artist (and keyboard support). |
| B39 | Idle player showed the last timestamp after clearing the queue — a final `timeupdate` from the removed source. Guarded on `loadedId`. |

Note: artist *Top songs* rows have no duration upstream (YouTube omits it in that shelf); they show plays and album instead. Album and playlist rows have durations.

### Round fifteen — artist fallback for incomplete releases

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B40 | Playing a track inside some albums showed **"Unknown artist"** | Those releases (auto-generated singles, photo albums) return rows with an empty subtitle — title, blank artist, plays. The artist exists only on the card that opened the page or in the artist context | Rows missing an artist are filled from (in order) the page's own artist link, the page header's artist, or — when opening an album from an artist page — the artist you came from. The artist/id are injected as subtitle + parts, so the link works too |

Verified: "The Answer is Daft Punk" (artist only on the search card) now plays as **Infinite Webs**, and *Random Access Memories* opened from Daft Punk's discography plays as **Daft Punk**.

### Audio-first playback

YouTube labels every playable item in its play endpoint: `MUSIC_VIDEO_TYPE_ATV` (official audio), `_OMV` (music video), `_UGC` (user upload). That field is now parsed into `CatalogItem.videoType` / `Track.videoType`.

Three layers, in order of strength:

1. **Rank** — search puts official audio first, then unclassified songs, then music videos, then uploads.
2. **Filter** — autoplay radio drops uploads and anything titled `(Official Video)` / `(Lyric Video)` / `(Visualizer)`, since the panel response carries no type field.
3. **Swap** — when a track marked `video`/`ugc` starts, the app looks up the released audio version (search by title + artist, cached per video id) and plays that instead, updating the queue entry (id, title, artist, duration, thumbnail) so the UI stays truthful.

Verified: playing the UGC lyric video `YEaAjrk0K1E "Dance the night away lyrics on screen…"` became ATV `FzYXYZX4QyE "Dance The Night Away"` before audio started. Radio now returns 41 tracks with no video uploads; search ranks ATV first.

### Playing indicator after an audio swap

Album pages list the **music-video** versions of tracks (`videoType: 'video'`), so every play there triggers the audio-first swap and the playing id changes to the official audio release. The row kept the old id, so `active` never matched and the equalizer disappeared.

`Track` now keeps `sourceId` (the id playback was launched from). `TrackRow` and `TrackView` treat a row as current if the playing track's `id` **or** `sourceId` matches.

Verified one active row + equalizer on album pages (current `_vOcbrUsmjM`, source `ajGKWk0auOc`), search results, and artist top songs.

### Round sixteen — resume after a dead source

| # | Symptom | Cause | Fix |
|---|---|---|---|
| B41 | After the app had been paused for a while, pressing Play looked like it did nothing: the dock stayed on Play at `0:00` while the cached stream URL had expired (HTTP 403). Repeated clicks made it worse. | `toggle()` resumed with `audio.play()` and swallowed the rejection. `recover()` did re-resolve with `force`, but had no UI state of its own, so the several-second wait was invisible; the retry budget could also stay exhausted, leaving the track unplayable until it was re-queued. | A dedicated `resume()` catches the rejection, resets the retry budget for an explicit play and calls `recover()`. `reconnecting` drives the same dock spinner as a first resolve (and blocks duplicate clicks), so the wait is visible. The first successful recovery clears it and resumes at the saved timestamp. Regression: `tests/e2e/reconnect.mjs` — it rejects one `play()` call, then asserts the spinner/`Loading` state appears and playback resumes with no error notice. |

## 15. Lyrics (shipped)

**Source.** LRCLIB (`https://lrclib.net/api`), the only keyless source with reliable time-synced lyrics for music. `/get` first with artist, cleaned title, album and duration; on a miss, `/search` and pick the result closest in duration with synced lyrics preferred. `instrumental` is respected, and plain lyrics are the fallback. Results — including misses — are cached in `lyrics.json` (300 entries, misses retried after 24h), so a track is looked up once.

**Panel.** A glass sidebar docked to the right edge (320–380px), sliding in over 300ms with `translateX` + opacity and `pointer-events: none` when closed. Header shows `LYRICS · LRCLIB` and a close button. Synced lines fade at the top and bottom via a mask, the active line scales up and turns white, past lines dim to 45%. The list auto-centres: an instant jump on open, smooth scrolling on every line change. Clicking a line seeks to it.

**Trigger.** A mic button sits between the quality tag and the mute control in the player bar, marked active while the panel is open; it toggles. The panel reloads automatically when the track changes while open and is disabled when nothing is playing.

**Verified.** 80 synced lines for *Instant Crush*, cache hit in 0ms, unknown track → `none`; UI: panel opens (`open`, 80 lines, 1 active, `LRCLIB`), clicking a lyric seeks, closing slides it out (`translateX(102%)`, pointer-events none).

Deviation from the original plan: the YouTube `timedtext` fallback was dropped — it almost never exists for music, and LRCLIB's plain-text tier already covers what it would.

### Lyrics polish

- **Closing transition.** `inert` on the panel froze the slide-out mid-flight in this Chromium build (it stalled ~30ms in at 92px). Replaced with `visibility: hidden` delayed by the transition duration, which keeps the panel out of the tab order when closed without interrupting the animation. Verified: 0 → 277px → 388px, opacity 1 → 0.17 → 0, then hidden.
- **Icon.** The microphone implied call muting; the button now uses a speech-bubble-with-lines glyph (Apple Music style).
- **Backup source.** If LRCLIB returns nothing (exact and search), `lyrics.ovh` is queried for plain text before giving up. "No lyrics" now means both sources came back empty. The result carries its source (`LRCLIB` / `lyrics.ovh`) in the panel header, and misses are still cached for 24h.
- **Line padding.** The active line's `scale(1.08)` is anchored to its left edge, so it stays aligned with every other line at the 22px inset. The container reserves the growth on the right (48px padding instead of 22px): the scaled box ends ~23px from the panel edge instead of overflowing it, and text still wraps at the same word boundaries when a line activates (no reflow jump). Inactive lines keep the 22px left inset; their wrap width is 8% narrower to provide the headroom. Verified with the longest line active: active and inactive text both start at x=823, the scaled box ends at 1156.7 against a panel edge of 1180, and `scrollWidth === clientWidth`.
- **Track change.** When the next song's lyrics load while the panel is open, the panel glides back to the top instead of snapping or inheriting the old position. The cached path reused the same `<div class="lines">`, so the previous song's scroll position (2809px at the end of *Instant Crush*) survived the track change and only moved once the new first line became active. The effect now watches the lyrics data object and starts `scrollTo({ top: 0, behavior: 'smooth' })` as soon as the new lyrics render — before the first timestamp — then centres the active line. Measured: starts at the clamped 1611px and settles at 0 in ~650ms. Regression: `lyrics-change` asserts both halves (it must not teleport; it must settle at the top).
- **Exit animation.** Closing mirrors the entrance: the same 300 ms `translateX(0 → 102%)` slide to the right, with the opacity fade spread linearly across the whole slide. The old exit used the entrance's 220 ms ease-out fade, which hit 17% opacity in 60 ms — the panel visually blinked out while 71% of it was still on screen. Measured after the fix: 45 ms → x=232, opacity 0.83; 112 ms → x=353, 0.61; fully hidden at ~311 ms, after it is off-screen. The entrance is untouched.

Verified: LRCLIB wins for *Instant Crush* (80 synced lines); `fetchOvhLyrics` returns 2911 characters of plain text from lyrics.ovh.

### Cached badge removed

The `cached` pill in the player dock is gone. It described our plumbing rather than the music, and the cache is bounded by the user's own cap. The quality tag (`OPUS 131k`) stays, and its tooltip still notes `cached on disk` for anyone who cares where the bytes came from.

## 16. Testing workflow

The old `tests/drive.mjs` was a 500-line monolith, so "run only what you touched" was impossible. It is now split into independent scenarios under `tests/e2e/`, with a selector:

```
node tests/e2e/run.mjs lyrics library     # targeted
node tests/e2e/run.mjs                    # all
node tests/unit.mjs lyrics library        # Node-side suites
```

`tests/drive.mjs` remains as an alias for the full scenario set. `TESTING.md` is the authoritative map: **changed file → suites to run**, plus the escalation rule (changes to `src/shared/**`, `src/preload/**`, `api.ts` or the player state machine mean run everything) and what the suites cannot check (media keys, window drag, RAM/CPU, audible playback).

Scenarios: `images`, `playback`, `reconnect`, `autoplay`, `links`, `lyrics`, `lyrics-change`, `library`, `resume`, `navigation`, `settings`. Each sets up its own state, runs silent, and restores volume/mute afterwards.


### Settings page (2026-10-19)

`Settings` is now a first-class view (gear icon in the sidebar) with:

- **Audio quality**: `Best available` / `Data saver`. The tier is enforced in the resolver
  (ceiling ~64 kbps), the download fallback (`bestaudio[abr<=64]`), and the URL cache
  keys include the ceiling, so switching quality cannot reuse a stream resolved at the
  other bitrate. Changing the setting clears the URL cache.
- **Autoplay**, **cache limit** (512 MB / 1 GB / 2 GB / 4 GB, applied immediately),
  **clear cache**, and a no-accounts footer.
- Runtime diagnostics moved out of Import; Import is now the migration surface only.

There is deliberately no 256 kbps option: the anonymous YouTube response contains only
49/51/67/129/131 kbps audio formats, so 256 kbps would be a control that lies.

### No system Python (2026-10-19)

Shipping contract: install and play. The user never installs Python and never sees a resolver screen.

- `scripts/fetch-runtime.mjs` vendors a relocatable CPython 3.12.15 (python-build-standalone, pinned `20261013`) into `resources/python/<os>-<arch>`, trims idlelib/tkinter/ensurepip/pip/headers (~12 MB), ad-hoc signs it on macOS (Apple Silicon refuses unsigned code), and vendors the 3 MB yt-dlp zipapp into `resources/bin`.
- `electron-builder.yml` ships it through `extraResources` with the `${os}-${arch}` macro. `npm run dist:mac` fetches both mac architectures; `dist:win` fetches the Windows x64 runtime on Windows.
- `binary.ts` prefers the bundled interpreter, then a system Python (development only), then the PyInstaller binary (unsupported fallback). `YtDlpInfo.runtime` reports which one ran; the resolver suite asserts `bundled`.
- Measurements on this machine: the official PyInstaller macOS binary is ad-hoc signed, **Gatekeeper-rejected**, and takes **21–25 s** for `--version`; the vendored CPython + extracted zipapp takes **0.2 s** warm (`--version`) and a normal cold music resolve is 2.5–6 s including network. The `.app` grows to ~332 MB (the runtime is 56 MB).
- Windows uses the same model (`cpython-…-x86_64-pc-windows-msvc-install_only.zip`). `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` keep yt-dlp's JSON safe on cp1252 consoles; `PYTHONPYCACHEPREFIX` points at userData so bytecode never needs a writable app bundle.

**Why yt-dlp and not a JS extractor.** There is no maintained pure-JS equivalent. `youtubei.js` speaks InnerTube but must chase SABR/PO-token/signature changes and still needs segmented-audio handling; `ytdl-core`/`@distube/ytdl-core` break whenever YouTube changes and do not model the music catalog; `youtube-dl-exec` is a wrapper that runs a binary. yt-dlp is the only engine with the maintenance and breadth, so we ship its interpreter instead of replacing it.

**Settings** no longer shows yt-dlp. It is an implementation detail that updates itself; a user-facing "runtime" row was noise.


### Branding (2026-10-19)

- **Source artwork** lives at `assets/Logo.png` (1024²). `npm run icons` (`scripts/make-icons.py`) produces the platform icons: a 1024 PNG with the logo on the standard 824px rounded tile (transparent margin), `resources/icon.icns` via `iconutil`, and a 16–256px `resources/icon.ico` via Pillow.
- **Packaging** points `mac.icon` and `win.icon` at those files. The built bundle reports `CFBundleName`/`CFBundleDisplayName = Viby` and `CFBundleIconFile = icon.icns`; the `.icns` in the app matches `resources/icon.icns` byte for byte. The DMG/NSIS artifacts use the same icon.
- **Development** sets the Dock icon from `resources/icon.png` and installs a custom application menu (`src/main/menu.ts`) instead of Electron's default File/Edit/View menu. Edit roles are preserved so copy/paste still works in the search fields and inputs.
- **Menu name caveat:** macOS renders the first menu item with the *bundle* name, not the template label. Dev runs the `Electron.app` helper, so it still says "Electron"; the packaged app shows "Viby" (verified by screenshot: Apple / Viby / Edit / View / Window). Windows and Linux get no native menu bar — the custom titlebar is the chrome — and the packaged Windows executable takes its icon from `win.icon`.

## 17. Offline mode and downloads (planned)

Status: planned, not started (2026-10-21). Scope locked with the product decisions below.

### 17.1 The distinction that drives everything

| | Cache | Downloads |
|---|---|---|
| Purpose | Speed and bandwidth | Listening without a connection |
| Visibility | Invisible | Explicit, listed, badged |
| Control | Automatic | User |
| Eviction | LRU under a cap | Never |
| Clearing | "Clear cache" | "Remove download" |

Downloads are explicit, user-owned and permanent until the user removes them — or until the collection that owns them is deleted and no other reference remains. They are listed in a Downloads view. A download hit is used before the cache; when a track becomes a download its cached copy is removed to avoid double storage (unless it is the file currently playing; then it is left for the next eviction). Clearing the cache never touches downloads, and removing downloads never touches the cache.

### 17.2 Locked decisions

- **Storage:** app-managed under `userData/downloads`. No folder picker, no exported files, no tag editing in v1.
- **Trigger:** automatic offline detection plus a manual offline switch.
- **Cache offline:** non-downloaded cached tracks play silently. No badge, no listing, no promise.
- **Scope:** songs, albums, playlists, Liked Songs. Liked Songs is a bulk action that downloads its tracks as individual songs, so unfavouriting never deletes a file.
- **Playlist deletion:** removes that playlist's download references; files with no remaining reference are deleted.
- **Defaults chosen for consistency:** no download cap; no auto-download of newly added tracks (explicit Update); download quality follows the playback quality at enqueue; downloads never sync with accounts; no export in v1.

### 17.3 Connectivity model

Main-process `NetworkMonitor`:

- `net.isOnline()` is polled every 5s, on startup and on `powerMonitor` resume; renderer `online`/`offline` events trigger an immediate re-check.
- `net.isOnline() === false` is authoritative offline. `true` is only a hint, so a transition to online is confirmed by a small `net.fetch` probe to `https://music.youtube.com/` (4s timeout; any HTTP response means reachable).
- States: `online`, `offline` (no link), `unreachable` (link up, YouTube not answering), `forced-offline` (manual). Both `offline` and `forced-offline` enter offline mode; `unreachable` shows the same local-first layout with a "Can't reach YouTube right now" header and a Retry action, so a YouTube outage does not produce a dead Home.
- Transitions are debounced (~2s); one failed probe does not flip the app. Failed catalog/resolve requests may report a hint, but HTTP 4xx/5xx and bot checks are not connectivity failures.
- Broadcast `network:changed` to renderers, with `network:get` and `network:setMode('auto' | 'offline')`. Manual mode persists in settings.
- A dev-only override forces each state for tests, independent of the machine's real network.

When effective offline and no local file exists, `resolveForPlayback` fails immediately with a `ResolveError('offline', …)` instead of spawning yt-dlp. No 10–60s DNS timeout.

### 17.4 UX specification

**Global**

- A compact titlebar status pill: "Offline", "Offline mode" or "Can't reach YouTube". Click opens a small menu with Manage downloads and, in manual mode, Go online. It is the only persistent offline chrome.
- Settings gains "Use offline mode" / "Go online" with the current connectivity reason.
- Sidebar gains **Downloads** (always present). While offline, Charts and Import are disabled with a tooltip; Search works against downloads (phase P7c).

**Home**

- Effective offline replaces Home with the Offline Home:
  - Heading: "You are not connected to the internet." (`unreachable`: "Can't reach YouTube right now.")
  - Sub: "Your downloads are ready to play." (manual mode: "Offline mode is on — using your downloads.")
  - Sections: Continue listening, Downloaded albums, Downloaded playlists, Downloaded songs.
  - Empty state: "Download music while you're online and it'll appear here."
  - "Manage downloads" link and storage summary.
- Reconnecting refreshes Home and shows a brief "Back online" confirmation. It never yanks the user off Downloads or Library.

**Downloads view**

- Header: count, total size, free disk space, "Delete all downloads" (confirmation).
- Groups: Albums, Playlists, Songs; each can play, remove, and shows n/m when incomplete.
- Renders from snapshots in the download index, so it works offline even though artist/album pages need the network.
- Song rows: play, remove, size and quality.

**Collection pages**

- Album, playlist and Liked Songs heroes get a Download action with states: Download · Downloading n/m · Downloaded · Update (when tracks are missing).
- Track rows get a download action/state in the existing hover cluster: idle, queued, downloading %, done, failed with retry.
- Deleting a playlist, or removing a track from it, prunes that playlist's references. The confirmation states how many downloaded songs will be deleted.

**Player and queue**

- Offline order: downloaded file → cached file → fail fast.
- A failed uncached track shows "You're offline. This song isn't downloaded." It does not auto-skip the whole playlist.
- Autoplay/radio warming is disabled offline; the queue stops at its end.
- Queue rows never expose cache state; downloads are marked.

**Settings**

- Cache copy becomes automation language: "Cached audio makes replays instant and reduces bandwidth. Managed automatically." The offline promise belongs to downloads.
- Downloads row: size, free space, Manage.
- Offline mode row.

### 17.5 Storage and data model

```
userData/downloads/
  index.json          entries, collection references, persisted jobs
  audio/<trackId>.<ext>
  art/<hash>.<ext>    offline covers
  tmp/<trackId>/      stable .part location for resume
```

```ts
type DownloadEntry = {
  track: Track              // snapshot: offline UI needs no catalog
  ext: string
  bytes: number
  bitrateKbps?: number
  art?: string
  downloadedAt: number
  quality: 'best' | 'data-saver'
  /** Reference keys that keep this file alive. */
  sources: string[]         // 'track:<id>' | 'album:<id>' | 'playlist:<id>' | 'liked'
}

type DownloadCollection = {
  key: string               // album:<id> | playlist:<id> | liked
  kind: 'album' | 'playlist' | 'liked'
  title: string
  thumbnail?: string
  art?: string
  trackIds: string[]        // snapshot at request time
  addedAt: number
}

type DownloadJob = {
  trackId: string
  track: Track
  sources: string[]
  state: 'queued' | 'downloading' | 'paused' | 'failed'
  error?: string
  attempts: number
}
```

- The index is the truth for playback. An entry without a file is healed away; a file without an entry is ignored.
- References: a direct song download adds `track:<id>`; an album or playlist adds its key to every member. Liked Songs also adds `track:<id>`, so unfavouriting keeps the download; its `liked` collection entry exists only for grouping. Removing a reference deletes the entry/file only when `sources` is empty. "Remove download" in Downloads clears all sources for that track.
- Collection snapshots keep offline grouping working; n/m is computed against the live library where it exists, otherwise the snapshot.
- Artwork is fetched at enqueue/download time through `net.fetch` (proxy-aware), size-capped, and served locally. Extend the media scheme's MIME table for images and restrict served paths to the cache/downloads roots as hardening.
- One file per track id regardless of how many collections reference it.
- On successful download, remove the cache entry; `kickOffBackgroundCache` skips downloaded tracks; cache eviction never sees downloads.

### 17.6 Download engine

- Own module and queue in main, separate from playback's resolver semaphore. Concurrency: **1 active download** in v1, leaving CPU and network to playback; the constant is documented for later tuning.
- yt-dlp per job:
  - `--no-playlist --no-warnings --continue --progress` (explicit), `--newline`
  - `--progress-template "download:VIBY %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s"`
  - `--print after_move:filepath` for the final absolute path
  - `-f bestaudio[abr<=64]/bestaudio/best` for data saver, `bestaudio/best` otherwise
  - `-o <downloads>/tmp/<id>/<id>.%(ext)s`, stable across retries so `.part` resumes
  - `--socket-timeout 15`, bounded retries
- Progress and the final path both arrive on **stdout** (verified 2026-10-21): lines starting with `VIBY` are progress, the last other line is the absolute file path. Fields may be `NA`; missing/unknown totals become an indeterminate UI rather than a broken percentage.
- Progress output is parsed tolerantly and throttled to ~4 events/s.
- On success: verify exit 0, file exists, nonzero size; move atomically into `downloads/audio`; fetch artwork; write the index; drop the cache copy; emit.
- Failures: transient network/timeout/5xx retried up to 3× with backoff; permanent (unavailable, private, bot check) marked failed with a readable reason, batch continues.
- Cancel removes the job and its partial; pause keeps the partial. Going offline pauses running/queued jobs (persisted) and resumes on reconnect.
- Removing a download that is currently playing pauses playback first; if the OS still holds the file (Windows), deletion is retried on next launch.
- Quit aborts children and persists jobs as paused; next launch resumes if online.
- Disk guard: refuse to start below a safety margin (500MB + estimate); ENOSPC during download becomes a per-track failure, never a crash.
- Keep `powerSaveBlocker('prevent-app-suspension')` active while downloads run, alongside playback.
- Explicit downloads use yt-dlp's own downloader, so segmented/HLS-only tracks that cannot stream in `<audio>` can still be downloaded.

### 17.7 Code map

**New**

- `src/main/network.ts` — monitor, probe, manual mode, broadcast
- `src/main/downloads/store.ts` — index, references, healing, stats
- `src/main/downloads/manager.ts` — queue, progress, retries, resume, disk guard
- `src/main/downloads/art.ts` — artwork fetch/cache
- `src/renderer/lib/network.svelte.ts`, `src/renderer/lib/downloads.svelte.ts`
- `src/renderer/components/DownloadsView.svelte`, `OfflineHome.svelte`, `DownloadButton.svelte`

**Touched**

- `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` — APIs and events
- `src/main/ipc.ts` — handlers, offline guard, download-first playback
- `src/main/library.ts` — prune references on playlist/track/like changes
- `src/main/cache/*` — skip downloaded; remove cache copy on download
- `src/renderer/lib/nav.svelte.ts`, `App.svelte`, `HomeView`, `DetailView`, `CollectionView`, `TrackRow`, `SearchBar`, `SettingsView`, `Queue`

Because `src/shared/**` and `src/preload/**` change, TESTING.md's escalation rule applies: targeted suites during development, the full set once before the feature is called done.

### 17.8 Delivery slices

**P7a — Offline awareness (no downloads yet).**
Monitor, renderer store, manual toggle, offline pill, Offline Home empty state, offline states for Charts/Import/Search, fast offline playback failure, silent cache playback, autoplay off offline.
*Acceptance:* airplane mode at launch shows the offline Home instantly, with no error toast and no yt-dlp delay when pressing play on an uncached track; reconnecting restores Home.

**P7b — Download core.**
Storage/index, manager, progress, per-song action, Downloads view (songs + storage), playback priority, cache dedupe, persistence/resume, cancel/retry, disk guard, artwork for songs.
*Acceptance:* download a song, quit, relaunch offline, play it from Downloads; clearing cache leaves it untouched; cancel and retry work.

**P7c — Collections and polish.**
Album/playlist/Liked actions with coverage and Update; grouped Downloads view; reference-based pruning; offline artwork for collections; offline local search; settings copy; low-disk warnings; queue polish.
*Acceptance:* download a playlist and play it fully offline; deleting the playlist removes only unreferenced files; a track shared with a downloaded album survives; offline search finds downloads.

**P7d — Hardening.**
Network flapping, failed-download recovery, quit mid-download, long playlists, Windows/macOS validation, `offline` e2e, docs.

### 17.9 Test plan

**Unit (main, no Electron):** index healing; reference add/remove and file deletion; cache/download dedupe; path safety; disk guard; download state machine with a fake runner; network state machine with injected `isOnline`/probe results; progress parser for known and unknown totals.

**E2E (`tests/e2e/offline.mjs`)** using the manual/debug override so it never depends on the machine's real network:

- offline launch → Offline Home, no catalog calls, no error banner;
- download one short track → progress → entry → file; play offline after relaunch;
- cached non-downloaded track plays offline; uncached track fails in under a second with friendly copy;
- delete a playlist → only unreferenced downloads removed;
- Clear cache leaves downloads; Delete all downloads leaves cache and library;
- reconnect restores normal Home; manual mode stays until switched off.

**Manual:** airplane mode on both platforms, Wi-Fi drop mid-download, quit mid-download, disk-full simulation, captive portal (`unreachable`).

### 17.10 Risks

| Risk | Mitigation |
|---|---|
| Storage bloat | Visible usage and free space, low-disk guard, easy deletion; no silent cap. |
| Progress format changes | One flag/parser module, tolerant of missing totals, indeterminate fallback, tests. |
| Offline detection false positives | `isOnline() === false` authoritative; online requires a probe; debounce; manual override. |
| Manual offline forgotten | Persistent titlebar pill and one-click "Go online". |
| Playlist deletion surprises | Reference counting and a confirmation that states how many songs will be deleted. |
| Cache/download duplication | Remove cache copy on download; skip background cache; download-first lookup. |
| Missing artwork offline | Store thumbnails at download time and serve locally. |
| yt-dlp failures | Per-track failure with reason, retry, batch continues; segmented formats are downloadable. |
| Long playlists / quit mid-download | Persisted queue, stable `.part` paths, resume, single concurrency. |
| Accounts/mobile confusion | Downloads are device-local and never synced; P6 accounts remain separate. |

### 17.11 Explicit non-goals (v1)

Exporting to Music/Finder, tag editing, download caps or quotas, auto-download rules, per-download quality overrides, syncing download state across devices, Android/SD-card storage, one-click artist discography downloads.
