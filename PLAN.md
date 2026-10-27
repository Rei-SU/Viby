# Viby — Implementation Plan

A no-ads, no-subscription, no-quality-cap desktop music client. Ad-free by construction (we own the client), no artificial bitrate ceiling. Listening never requires an account; an optional account (later) backs up and syncs the library across devices.

Last updated: 2026-10-27 (rev 8)

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
| 7 | Import | Paste share URLs, no credentials, ever | Spotify via embed bootstrap + anonymous GraphQL, with the embed's first 100 tracks as fallback; Apple Music via share-page JSON; **zero accounts required from you** |
| 8 | Import conflicts | Auto-match + review screen | No silent wrong-version imports |
| 9 | Unresolvable tracks | Skip + notify | Simple, honest |
| 10 | Charts | Removed | The dedicated page duplicated Home shelves; chart carousels still appear inside Home where YouTube Music surfaces them. |
| 11 | Language | English only | No i18n layer, no RTL work in v1 |
| 12 | Playback auth | Anonymous, no credentials stored | Playback needs no login and stores no credentials. The optional account layer (later) is separate. |
| 13 | Lyrics | Layered fallback chain | LRCLIB exact → LRCLIB search → lyrics.ovh plain text, all cached |
| 14 | Shell | Slim sidebar + art-forward heroes | Apple Music feel, still navigable |
| 15 | OS integration | Media keys + Now Playing, no tray/mini-player | `navigator.mediaSession` — no native code |
| 16 | Quality | User-selectable, default best, **never auto-downgrade** | Honour the setting exactly; buffer rather than reduce bitrate |
| 17 | Delivery | Auto-update via GitHub Releases | Release builds are automated: pushing a `v*` tag builds macOS (Intel + Apple Silicon) and Windows and publishes to GitHub Releases. Windows installs updates in place; macOS notifies, downloads and opens the DMG because an unsigned build cannot self-update (see §2.1). |
| 18 | Distribution | Public beta on GitHub; built for me and a few friends first | Installers, first-run setup, graceful upstream failure |
| 19 | Name | Viby | Bundle ID, installers, window title |
| 20 | Deferred | No EQ, gapless, crossfade, sleep timer, scrobbling, Discord, stats, sync, mobile | Kept out of v1 deliberately; accounts/sync and mobile are planned post-v1, not abandoned. |
| 21 | Phase order | Skip the standalone spike, start on the real player | P1's first task *is* the resolver proof — see §9 |
| 22 | Front door | Home + Search are the app; links are only for import | Search/browse shipped before anything link-shaped. The paste box moved into an explicit Import tab. |
| 23 | Player-client rotation | Don't pin clients; let `yt-dlp` choose, pin only as fallback | Measured 2026-10-18: every pinned set was SABR-only or failed. See §2.4. |
| 24 | Accounts (later) | Optional, local-first, for backup and sync | Never a prerequisite for listening or the local library. Built only after the core is polished, and designed alongside the planned mobile client. See §9 P6 and §10. |
| 25 | Offline & downloads | Explicit downloads + a first-class offline mode; cache stays invisible | Downloads live in app-managed storage, are never auto-evicted, and belong to the user. Offline mode is automatic with a manual override. See §17. |

## 2. Reality checks that shaped the design

Five assumptions that "obviously work" in most music-app plans do not. Verified against upstream docs and working projects, not guessed.

**2.1 — macOS in-place auto-update requires code signing.** Squirrel.Mac validates the downloaded app against the running app's designated requirement. Our build is only linker-signed ad-hoc, and its requirement is a `cdhash` that changes with every build (verified: `codesign -d --requirements`), so Squirrel can never accept the next version. Windows NSIS auto-update works unsigned. macOS therefore downloads the correct DMG from GitHub and opens it — one drag, no release page. In-place macOS updates return with a Developer ID signature and notarization.

Updates are integrity-checked on both platforms: `update-manifest.json` is signed with Ed25519, verified against the public key pinned in `src/main/update-key.ts`, and the installer's sha256 must match the signed manifest. A missing manifest, bad signature or hash mismatch fails closed. The key is already pinned; releases require the matching `VIBY_UPDATE_KEY` secret in CI, and the publish job refuses to go live without it. Builds without a pinned key fall back to GitHub's asset digest over TLS; the shipped build does not.

**2.2 — Media keys must go through `navigator.mediaSession`.** Electron's `globalShortcut` has a long-standing broken-on-macOS bug for media keys, while `mediaSession` is a standard Chromium feature that populates macOS Now Playing and Windows SMTC with zero native code.

**2.3 — `yt-dlp -U` only works on a writable release binary.** The copy inside `Viby.app/Contents/Resources` is not writable and modifying it breaks the bundle signature, so the binary is copied to user data on first run and updated there.

**2.3a — The macOS PyInstaller build is unusable here; the zipapp is not.** Measured on this machine, with the network verified at 0.23s to first byte:

| Runner | `--version` | Full resolve |
|---|---|---|
| `yt-dlp_macos` (37MB PyInstaller, what the app shipped first) | **25–45s** | 34–70s |
| zipapp (3MB) under system Python (dev fallback) | 1.9s | 4.7s |
| zipapp **extracted once** under vendored CPython 3.12.15 | **0.6s** | **2.9s** |

`spctl -a` **rejects** the PyInstaller binary (ad-hoc signed), so macOS re-assesses it on every launch — the whole 25–45s is Gatekeeper, not YouTube. The app now provisions the zipapp, unpacks it into `userData/bin/yt-dlp-src/`, and runs it with the bundled CPython (or a discovered system Python in development). The PyInstaller binary remains only as a fallback for Windows and for machines with no Python.

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

**2.5 — Spotify needs no account after all.** `open.spotify.com/embed/playlist/{id}` exposes an anonymous access token and the first 100 tracks to public visitors. That token drives the web player's `fetchPlaylist` GraphQL pathfinder for full pagination, with the embed list as the fallback if the persisted-query hash rotates. Multiple independent working projects confirm the path. No credential, no Premium, no dev app.

## 3. Architecture

Three processes, strict separation, minimal IPC surface.

```
┌─────────────────────────── Electron main (Node) ───────────────────────────┐
│  window/lifecycle   IPC router   settings   connectivity   downloads       │
│                                                                              │
│  ┌── innertube/ ──────────┐  ┌── ytdlp/ ──────────────────────────────┐     │
│  │ catalog: search,       │  │ binary provisioning + self-update      │     │
│  │ browse, home,          │  │ resolve stream URL (JSON)              │     │
│  │ album/artist/playlist  │  │ download-to-cache (fallback path)      │     │
│  └────────────────────────┘  └────────────────────────────────────────┘     │
│                                                                              │
│  ┌── library/ ────────────┐  ┌── cache/ ────────┐  ┌── lyrics/ ──────────┐  │
│  │ playlists, favorites,  │  │ audio LRU (1GB)  │  │ LRCLIB → lyrics.ovh │  │
│  │ history, downloads     │  │ art LRU (256MB)  │  │ plain, all cached   │  │
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
│  player store (runes)     lyrics view                 paged lists            │
│  routes: Home Search Library Queue Album Artist Track Import Settings        │
│  components: PlayerBar, Queue, Cover, LyricsPanel, DownloadBadge            │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why the catalog/stream split.** InnerTube provides rich music metadata (albums, artists, charts, continuations) that `yt-dlp` cannot; `yt-dlp` provides reliable stream URLs that raw InnerTube player calls increasingly cannot. Each does what it is good at.

### Data flow: playing a track

1. Renderer requests `player.resolve(trackIdOrUrl)`.
2. Main checks explicit downloads first, then the audio cache. **Hit** → returns a local file path, instant play; a download always wins over a cached copy.
3. **Miss** → `yt-dlp -J` resolves a direct audio URL (default client selection; see §2.4). This is the only slow step (~2.9s cold), so it is moved *before* the click wherever intent is visible: hover, the first rows of a list, the next queue track, the top of Recently played.
4. Renderer sets `audio.src` and plays.
5. Background: if the track passes the cache-worthiness test (§6) and is not an explicit download, `yt-dlp` caches it so the next play is a hit.
6. Format URLs are IP-bound and expire (~6h). A 403 triggers one transparent re-resolve, then a download-to-cache fallback.

## 4. Tech stack

Lean on purpose. Every dependency is justified against the RAM/CPU budget.

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron | Your call; mature packaging and native media integration |
| Main language | TypeScript on Node | Shared types with renderer; no second language to build |
| Renderer framework | **Svelte 5** | Compiles away — no virtual DOM, minimal runtime, lowest idle CPU of the mainstream options |
| Bundler | Vite + electron-vite | Fast HMR, small renderer bundles, one config for all three processes |
| Persistence | Atomic JSON stores | `node:sqlite` was evaluated and rejected: the stores are small (favourites, history, playlists, settings), so synchronous temp-file + rename writes are simpler, crash-safe and dependency-free. |
| Audio | Single `<audio>` + Chromium decoder | Native decode = no extra CPU; `mediaSession` gives OS integration free |
| Resolution | Bundled `yt-dlp` (+ PO-token provider) | §2.3, §2.4 |
| Lyrics | lrclib.net + lyrics.ovh (no keys, no registration) | Verified free; LRCLIB supplies synced lyrics, lyrics.ovh the plain-text backup |
| Packaging | electron-builder; electron-updater drives in-place Windows updates | NSIS on Windows; DMG on macOS (manual update install until Developer ID signing) |

**Deliberately not used:** React/Redux (runtime cost buys nothing here), any UI kit, Prisma/TypeORM, `better-sqlite3` (native rebuild risk for no benefit over `node:sqlite`), Web Audio graph (adds CPU until an EQ exists), `hls.js` (extra decode path), Tailwind (a handful of CSS custom properties is lighter).

**Runtime dependencies: exactly one.** `electron-updater` drives in-place Windows updates; macOS reads the public GitHub release feed instead (§2.1). Everything else is dev-time.

**Dependency security:** Electron 45 and electron-builder 26.15.3 are the security-patched baseline. `npm audit` reports zero vulnerabilities; the `global-agent` override keeps electron-builder's build-time download path on v4 instead of pulling the vulnerable v3/proxy stack.

## 5. Feature specification

### 5.1 Playback (core)
- Play/pause, next/previous, seek, volume, mute, shuffle, repeat (off/all/one).
- Queue: add next, add to queue, reorder, remove, "clear upcoming".
- Resume where you left off on relaunch; restore queue.
- Sleep prevention while playing (Electron `powerSaveBlocker`).
- Media keys + OS Now Playing via `mediaSession`, with artwork.
- Settings: quality (best available / data saver ~64kbps, honoured exactly — no auto-downgrade), autoplay, background playback (close hides to the tray/menu bar), cache cap and clear cache, offline mode, and downloads storage.
- On a slow network: buffer, never silently reduce quality. If it can't keep up we tell you, we don't decide for you.

### 5.2 Search
- Instant search, 250ms debounce, in-flight cancellation (stale responses dropped by request sequence number).
- Filters: songs, albums, artists, playlists.
- Results render in pages on long lists; artwork lazy-loads with a low-res placeholder.
- Search is online-only. When the app is local-first, the titlebar field is disabled and the Search page says “You are not connected to the internet.” (or “Cannot connect to the host right now.” for an unreachable host).
- Keyboard: `/` focuses search, `↑/↓` navigate, `Enter` plays, `Shift+Enter` queues.

### 5.3 Browse & categories
- Home shelves from YouTube Music, including chart and mood carousels when they are surfaced.
- Dedicated moods/genres browsing is deferred (see §9 P4); only the shelves YouTube Music surfaces on Home are present.
- Home: recently played plus YouTube Music's home shelves; artist, album, playlist and song pages open from any card or row.

### 5.4 Library
- **Favorites** and **playlists** are local-first and never vanish when upstream changes. They stay on the machine by default; optional accounts (later) back them up and sync them across devices.
- **History**: every played track with timestamp and completion ratio, capped at the last 5,000 plays; feeds "recently played" and lets the cache policy promote repeatedly-played tracks.
- Playlist cover = first track's artwork; user-picked cover art is not in v1.
- **Downloads** are part of Library, not a separate page: badges, partial-progress rings, a Downloaded filter, and a standalone-songs section. See §17.
- Every track row: play, queue-next, add to playlist, favorite, download, go to album, go to artist.

### 5.5 Lyrics
Layered, in this order, each result cached permanently:
1. LRCLIB `/api/get` with title, artist, album and duration.
2. LRCLIB `/api/search` with cleaned title and artist, choosing the closest duration and preferring synced lyrics.
3. `lyrics.ovh` plain text when LRCLIB has nothing.
4. No lyrics only when both sources come back empty.

Duration is included in the LRCLIB signature (±2s tolerance) because it sharply improves match accuracy. Synced lyrics get auto-scroll with the active line pinned and click-to-seek on any line. All requests send an identifying `User-Agent`, as LRCLIB asks.

### 5.6 Playlist import — no accounts, no credentials, no exceptions

| Service | Method | Fragility |
|---|---|---|
| YouTube Music / YouTube | InnerTube playlist reader; exact video ids, no search | Low |
| Deezer | Public API, no key | Low |
| Spotify | Embed token bootstrap + anonymous `fetchPlaylist` GraphQL; embed's first 100 tracks as fallback | Medium |
| SoundCloud | Extract `client_id` from the web player | Medium |
| Apple Music | Share-page embedded JSON (no free official API exists) | High |

Import is link-only by decision: no CSV or plain-text floor in v1, and only playlist links are accepted.

**Matcher behaviour** (#8): exact title+artist match on YouTube Music search → auto-accept. Low confidence (fuzzy-only match, duration mismatch >10s, or several close candidates) → the review screen shows candidate choices with artist and duration, and lets you pick, skip, or leave the row unmatched. Nothing is silently wrong. YouTube playlists bypass matching and use their exact ids; album-level import is not in v1.

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
| Scrolling | 60fps while paging a 5,000-row playlist | DevTools performance trace |

**Measured 2026-10-18** (`tests/resolver.test.ts`): warm resolve **0ms** from memory and **0ms** from the persisted URL cache after a restart; cold resolve **2.9s**; process startup **0.6s**. The first version of this measured **25–45s** — see §2.3, it was the `yt-dlp` binary, not the network. Clicks on prefetched rows (the top of every list, the hovered row, the next track) are therefore effectively instant.

**Measured 2026-10-26 on the packaged x64 build** (`npm run measure`, Electron 45.0.0, Intel Mac, macOS 15.7.7). The window was kept frontmost and the display awake for the whole run: an occluded window or a sleeping display is throttled by macOS and reports numbers that are too low. RSS is the sum across the Electron process tree.

| State | Summed RSS | CPU |
|---|---|---|
| Idle (Home, 60s after load) | 373 MB (373–374) | 0.39% |
| Playing, window frontmost | 434 MB (422–448) | **7.63%** (renderer 4.0%, GPU 1.7%, utility 1.1%, main 0.9%) |
| Playing + lyrics | 466 MB (451–474) | **12–18%** (renderer 8.4%, GPU 7.4% in the 17.7% sample) |
| Paused after playback | 455 MB | 0.77% |

- **Startup:** page 560–731 ms, shell 755–1106 ms, Home cards 755–1238 ms on warm launches. The first launch after a fresh unsigned build can take ~4 s while macOS scans the bundle.
- **Bundle (Electron 45):** 425 KB JS + 92 KB CSS raw = **100 KB gzip**.
- **Soak:** 452 → 455 MB over 2 minutes (+3 MB), no leak. CPU 11.61% with the lyrics panel open.
- **What was eating the CPU:** hiding the player dock cut playing CPU from ~12.0% to ~6.2%; hiding just the scrubber got ~6.3%, while hiding only the seek input or only the time labels changed nothing. The JS profile was almost entirely idle: the cost was layout, style recalc and compositing triggered by `timeupdate` firing ~4×/s (`RecalcStyleCount` 39 → 10 and `LayoutCount` 21 → 10 per sample once throttled). `backdrop-filter`, animations, layer containment, `will-change` and moving the scrubber out of the dock made no meaningful difference.
- **Fix:** the renderer now mirrors the clock into the UI and the OS media session at most once per second. Seeks, pauses, play and metadata load still update immediately, and pause/seek persist the exact position. Playing CPU fell from **11.97% to 7.63%**. The lyrics state stays at 12–18% across runs (14.3% before the change): it is dominated by the panel's smooth scrolling and masked, composited layer, not by the clock, and is the largest remaining consumer.
- **Remaining floor:** with 1 Hz updates and the scrubber hidden, CPU is **5.23%** (renderer 3.20%, utility 1.07%, main 0.87%, GPU 0.10%). A visible live progress bar adds ~2.8 points even at 1 Hz, so the <5% playing target is **not reachable on this Intel Mac** without removing the scrubber. Idle is well inside its ceiling (0.39% CPU, 373 MB with 27 MB of RAM headroom); playing and lyrics exceed 400 MB only because of audio/GPU buffers, which the budget does not cap.

Techniques that get us there:
- **Paged lists on long collection pages.** Detail pages render 120 rows at a time; full list virtualization is still on the roadmap (README). The single biggest remaining win.
- **Bounded caches with real eviction.** Audio 1GB LRU, art 256MB LRU, eviction in main. Never unbounded.
- **Lazy everything.** Art at display size, placeholder first, `loading="lazy"`, off-screen rows never request art.
- **One decode path.** Chromium's audio pipeline. No Web Audio graph, no transcoding.
- **No UI polling or interval refresh.** Connectivity probes only while the monitor is running; downloads report progress from their own queue. Position updates come from `timeupdate`, throttled to 1 Hz so the progress bar, clock and OS media session do not force a layout on every media tick.
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
| R4 | macOS auto-update impossible unsigned | No silent updates on your main machine | Wired: Windows checks, downloads and installs in place; macOS checks GitHub Releases, downloads the matching DMG and opens it. Silent macOS updates remain blocked until Developer ID signing/notarization. | Accepted |
| R5 | Apple Music import depends on scraping | Import breaks | Keep each adapter isolated; failures are per-track and the rest of the import continues. | Accepted |
| R6 | Spotify embed truncates long playlists | Partial import | Anonymous-token bootstrap pages past the embed limit; the review screen reports the track count, and the embed's first 100 remain a fallback. | Low |
| R7 | SoundCloud `client_id` rotation | Import breaks | Re-extract from the web-player JS on failure; per-track failures continue the batch. | Low |
| R8 | Update manifests need a signing key | Release pipeline cannot auto-update | Done: an Ed25519 key is generated and its public half is pinned in `src/main/update-key.ts`; CI must hold the private half as `VIBY_UPDATE_KEY`. The publish job fails closed if the secret is missing. Rotating the key strands installed builds. | Low — depends on the CI secret staying available |
| R9 | ~~`safeStorage` prompts on unsigned builds~~ | — | **Eliminated** — no credentials are stored anywhere | None |
| R10 | Electron RAM creep | Breaks the core requirement | The budget table is enforced; dependency additions must be justified. Runtime deps: one. | Low |
| R11 | Legal / ToS | Takedown or account risk | Public beta on GitHub, no monetisation, no DRM circumvention; `yt-dlp` is Unlicense. A wider release would invite DMCA pressure — re-plan then. | Accepted, your call |

## 8. Repository layout

```
viby/
├── package.json
├── electron-builder.yml
├── electron.vite.config.ts
├── PLAN.md / README.md / TESTING.md
├── assets/                       # source logo + README artwork
├── docs/                         # import research, screenshots
├── resources/
│   ├── bin/yt-dlp.pyz            # copied to userData on first run
│   ├── python/<os>-<arch>/       # vendored CPython runtime
│   ├── yt-dlp-plugins/           # PO-token provider (R1)
│   └── icon.icns / icon.ico / icon.png
├── scripts/                      # fetch-runtime, icons, measure
├── src/
│   ├── main/
│   │   ├── index.ts              # lifecycle, single-instance lock, background switches
│   │   ├── windows.ts
│   │   ├── ipc.ts                # typed channels + validation
│   │   ├── settings.ts
│   │   ├── json-store.ts         # tiny atomic JSON store
│   │   ├── library.ts            # favorites, history, playlists
│   │   ├── session.ts            # resume queue and position
│   │   ├── media.ts              # viby-media:// scheme
│   │   ├── menu.ts
│   │   ├── network.ts            # connectivity monitor + manual mode
│   │   ├── lyrics.ts             # LRCLIB + lyrics.ovh
│   │   ├── cache/                # audio LRU, image cache, policy
│   │   ├── downloads/            # index, engine, artwork
│   │   ├── innertube/            # catalog: constants, parse, client
│   │   ├── import/               # Spotify, Apple, Deezer, YouTube, SoundCloud
│   │   └── ytdlp/                # binary provisioning + resolver
│   ├── preload/index.ts          # contextBridge, the only exposed API
│   ├── shared/                   # types + IPC channel contract
│   └── renderer/
│       ├── index.html
│       ├── main.ts
│       ├── App.svelte
│       ├── lib/                  # player, network, downloads, nav, artwork...
│       ├── components/           # views, rows, player, lyrics, downloads
│       └── styles/
└── tests/
    ├── unit.mjs                  # Node-side suites via esbuild
    ├── e2e/                      # live-app scenarios
    └── *.test.ts
```

## 9. Delivery phases

**P1 — Playback core. Shipped.**
Resolver proof first, by design (your call to skip the standalone spike): the very first thing built is `yt-dlp` provisioning plus single-track resolve-and-play, which is exactly the thing the spike would have tested. If PO tokens defeat anonymous playback, we find out in the first hours rather than after the UI exists.
Then: player bar with seek/volume/shuffle/repeat, queue, media keys, Now Playing, settings, cache with eviction, history and favorites.

*Built and verified:* `yt-dlp` provisioning into userData (with self-update), client-rotation resolver with a S2 concurrency cap, resolve-URL cache with 2h TTL, bounded 1GB LRU audio cache with eviction, download-to-cache fallback for SABR-only tracks, background caching driven by the cache-worthiness rule, local-first favorites and history, JSON settings, a privileged `viby-media://` scheme for serving cached audio without weakening `webSecurity`, and a Svelte 5 player with queue, seek, volume, shuffle, repeat, and full `mediaSession` integration.
*Typecheck and build are clean; the current bundle is tracked in §6.*

**P1.5 — Crash fix and honest failures. Done.**
`yt-dlp` prints the literal string `null` to stdout with exit code 1 when extraction fails; we treated that as data and crashed in `parseTrack` with `Cannot read properties of null (reading 'id')`, discarding the real reason in stderr. Now every failure path is validated (`code !== 0 || !trimmed || trimmed === 'null'`), mapped to a readable message (`unavailable`, `botcheck`, `playlist`, `cancelled`, `unknown`), and shown in the UI. A resolve can also be **cancelled**, so a slow track can no longer hold the window for two minutes. Regression tests: `tests/resolver.test.ts`.

**P2 — Search + browse + library. Shipped.**
Shipped: the InnerTube catalog client (`WEB_REMIX`, one constants file for R2), tolerant cross-container response parsing, search with filters (All/Songs/Albums/Artists/Playlists), home shelves (including chart carousels), album/artist/playlist detail pages, and click-to-play straight from any of them.
Shipped after the first pass: likes, playlists and history built on the atomic JSON stores (not `node:sqlite`), collection pages, the add-to-playlist picker, and artist discography tabs.

*Acceptance:* find a song, play it, favourite it, build a playlist, restart, everything is still there. **Met.**

**P3 — Lyrics. Shipped.**
Full fallback chain, synced auto-scroll, click-to-seek, permanent caching.

*Acceptance:* a synced track highlights the correct line throughout playback and still works offline from cache.

**P4 — Browse + import. Shipped.** Link-only import for Spotify (anonymous web-player GraphQL, public playlists), Apple Music (page JSON), Deezer (public API), YouTube Music (100-row continuations) and SoundCloud (scraped web-player client id). The matcher scores title/artist/duration, auto-accepts exact matches, reviews the rest, follows progress/cancel and creates the playlist in source order. YouTube playlists use their exact ids (no search). `ImportView` is the single paste-a-link surface. Research below:

*Acceptance:* paste a public Spotify/Apple Music/Deezer/YouTube Music/SoundCloud playlist; the source
appears, tracks are matched or visibly flagged, and the playlist is created in source order. Verified:
Today's Top Hits (50) → 48 auto / 2 review / 0 missing; a 951-track YouTube playlist imports in ~11s.
Deferred beyond this slice: moods/genres browsing, private/collaborative Spotify playlists, and Liked Songs. The CSV/text floor was dropped by decision (link-only interaction).

**P5 — Ship. Shipped, with macOS signing deferred.**
Installers (DMG + NSIS), bundled runtime with no system Python, first-run provisioning, error states for upstream and offline failures, release automation (GitHub Actions on `v*` tags) and in-app updates are in place. Windows checks, downloads, verifies and installs in place (NSIS, per-user); macOS checks, downloads the matching DMG, verifies it and opens it, because an ad-hoc-signed build cannot satisfy Squirrel.Mac (§2.1). Checks never download on their own, transfers can be cancelled, a stalled transfer times out, and skipped versions are remembered. Windows 11 manual checks pass on Electron 45, including in-client updates; Windows 10 uses the same x64 build and is covered by that pass by maintainer decision. macOS signing/notarization is deferred because it requires a paid Apple Developer account, so unsigned DMGs remain the current release path. The update-signing key is generated and pinned in `src/main/update-key.ts`; CI must provide its private half as `VIBY_UPDATE_KEY`, or the release workflow refuses to publish.

*Acceptance:* a friend installs Viby from a DMG on their own Mac, imports a playlist, and plays music without you touching their machine. The unsigned DMG needs the documented right-click → Open first launch; this has not been formally verified with an external user.

**P6 — Accounts and sync. Deferred on purpose.**
Not started. Begins only once P5 is done and the core experience is fully polished — playback correct, the look and feel settled, and no open fundamentals. Until then the profile avatar stays a placeholder.

Scope: optional accounts with end-to-end encrypted backup and sync of favorites, playlists, history and settings across devices, designed alongside the planned Android client. Local-first remains the source of truth; signed-out use is unchanged. Sync must support export, account deletion and transparent conflict handling.

*Acceptance:* two machines signed into the same account converge on the same library after an offline edit, and signing out leaves a complete, usable local library. Export and account deletion need no support ticket.

**P7 — Offline mode and downloads. Shipped (P7a–P7c); P7d's packaged/manual pass remains.**
The full specification and current behavior are in §17. Connectivity + offline shell, the download engine, Library integration, collections, artwork and the offline Search notice are all shipped.

*Acceptance:* with the network off, the app opens into an offline Home showing downloaded music; a downloaded album plays end-to-end offline after a relaunch; undownloaded cached tracks still play silently; uncached playback fails fast with a human message; deleting a playlist removes only downloads no other source still needs. Met in macOS development tests; the Windows 11 manual offline/download pass is done on Electron 45, and Windows 10 is covered by the same x64 build by maintainer decision. P7d's remaining manual edge cases are listed in §17.8.

## 10. Open items

Settled: cache cap (1GB), quality policy (never downgrade), Spotify (no credentials), phase order (skip spike, straight to P1), language (English), charts (dedicated page removed; shelves stay in Home), accounts (optional, local-first, post-v1 — see §9 P6), repeat-one (restarts the track), and history retention (last 5,000 plays).

No blocking product questions remain. P5 is shipped with macOS signing deferred; P7d's remaining manual edge cases and P6 track the remaining work.

## 11. Build notes and gotchas

Things that cost time, recorded so they don't cost it twice.

- **npm 11 gates install scripts.** The repo's `allowScripts` covers `electron@45.0.0` and `esbuild`, so a fresh `npm install` gets a working Electron binary. Optional `fsevents` and `electron-winstaller` scripts stay blocked; neither is needed for macOS development or NSIS packaging. When Electron moves, update the version-pinned entry.
- **No native modules, on purpose.** `better-sqlite3` would need a node-gyp rebuild. Electron 45 ships Node 24, so `node:sqlite` is available, but these stores are small and JSON-shaped; atomic JSON remains the simpler, crash-safe fit. P1 therefore uses atomic JSON stores.
- **Cached audio is served over `viby-media://`, not `file://`.** Chromium blocks `file://` media from an http origin, and the usual workaround is disabling `webSecurity`. Registering a privileged custom scheme avoids that trade entirely — every security flag stays on.
- **Runtime dependencies: exactly one** (`electron-updater`, wired for in-place Windows updates). Everything else is dev-time, which is what keeps the RAM budget honest.
- **Media keys route through `mediaSession`, not `globalShortcut`.** `globalShortcut` media-key registration is broken on macOS (a long-standing Electron bug); everything goes through `navigator.mediaSession`, which also gives us Now Playing and Windows SMTC for free.
- **The dev log** is the terminal running `npm run dev`; renderer console output is forwarded there by `windows.ts`.
- **`yt-dlp` exits 1 and prints the string `null` on stdout when a video fails.** Checking `code !== 0 && !stdout.trim()` is not enough — `"null"` is non-empty, so it parses to `null` and crashes the caller. Always treat `code !== 0`, empty output, **or literal `null`** as failure, and read the reason from stderr.
- **Chromium cannot play HLS in an `<audio>` element.** `yt-dlp` happily offers `m3u8_native` audio at a competitive bitrate; feeding it to the player looks exactly like a broken stream. Filter to `protocol: 'https'|'http'` and fall back to download-to-cache otherwise.
- **Don't pin `--extractor-args youtube:player_client=…`.** See §2.4: as of 2026-10-18 it is what breaks playback, not what fixes it.
- **Profile process startup before blaming the network.** The first "playback is slow" diagnosis blamed YouTube; `yt-dlp --version` alone took 25–45s while `curl` reached YouTube in 0.23s. If something feels slow, time the empty case first.
- **`python3 -S` breaks HTTPS in yt-dlp** (`CERTIFICATE_VERIFY_FAILED`, because `site` is what sets up certificate paths on the macOS framework build). It saves 300ms of startup and costs you all network access — don't.
- **Playback speed comes from prefetching, not from a faster resolver.** Catalog metadata is instant (InnerTube), so the app resolves stream URLs ahead of the click: the first few rows of every list, the hovered row, the next queue track, and the top of Recently played. The URL cache is persisted to disk for two hours, so restarts do not repeat work.
- **Resolve latency breakdown (this machine):** ~0.6s Python startup + ~2.3s yt-dlp network work = ~2.9s cold. Warm is 0ms, so the UX target is met by "resolve before the user asks".
- **Tests run outside Electron** by aliasing `electron` to a stub, which makes main-process modules testable without a GUI. The runner bundles each suite with esbuild:
  ```
  node tests/unit.mjs resolver innertube   # targeted
  node tests/unit.mjs                      # all Node-side suites
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

Measured: radio returns **49 related tracks**, all playable, with artists and durations (80s pop for a Rick Astley seed). End-to-end: queue 1 → 26 and playback moved to "Take Me to Your Heart" — a related track, not a search sibling. The toggle ("Autoplay similar songs when the queue ends") lives in Settings and persists.

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

**Shape & motion.** 22px panels, 16px cards, 12px controls, 999px pills. One easing (`cubic-bezier(0.22,1,0.36,1)`), 160ms, and `prefers-reduced-motion` disables transitions and decorative entrances while keeping status spinners and equalisers moving.

**Components.** `Icon.svelte` replaces every emoji with a 24px stroked glyph set. `PlayerBar` is a floating dock with an accent play button and a filled scrubber. `HomeView` cards lift 3px on hover with a play badge and a slight image dim. `TrackRow` shows a three-bar equaliser on the playing row and surfaces artist/album links on hover. Detail and song pages add an artwork bloom (`filter: blur(70px)`, 30% opacity) behind the header.

### Design revision — monochrome, flat, icon rail

- **No colour accent.** White is the accent: primary buttons are white with black glyphs, the playing row and active nav are plain white, the scrubber fills white, and the ambient wash is neutral (`rgba(255,255,255,0.045)`). Red remains for errors only.
- **No rounded panels.** Sidebar, titlebar and player dock are flush edge-to-edge with hairline dividers (`border-right` / `border-top`). Only content elements keep radii (cards 12px, rows 10px, controls 8px, actions pill).
- **Fixed icon rail.** The 68px sidebar shows only icons, vertically centred in the available height. Hovering or keyboard-focusing an icon reveals its name in a themed glass label; the labels are also the buttons' accessible names. There is no expand/collapse state or persisted sidebar width — the titlebar keeps its extra room.
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

### Search page (2026-10-23)

The titlebar search and the Search page no longer duplicate each other: while the Search page is open the
titlebar dropdown stays closed and typing only updates the page. The Search page now renders a grouped,
Spotify/Apple-Music-style layout — a **Top result** card, then **Songs** (list), **Artists**, **Albums**
and **Playlists** (card grids), each with a **Show all** that switches the filter and loads the full
category. The "All" view is built from the same per-category searches the dropdown uses, so a song row on
the page is identical to one in the dropdown (same metadata and ordering). Recent searches are shown when
the query is empty. Filter chips still switch between all and a single category.

### Browser-style navigation (2026-10-20)

Navigation moved out of the page and into the titlebar: **Back** and **Forward** buttons
with browser semantics. The history stack records detail, song, collection *and* tab
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

### Queue panel and drag reorder (2026-10-27)

The Queue was a destination (a rail item and a full page) while Lyrics was a dock. They now share one right-hand panel. `sidePanel.mode` is `'lyrics' | 'queue' | null`; the player dock carries Queue and Lyrics buttons, and `SidePanel.svelte` owns the grid column, width, hairline, header and close button. `LyricsPanel` and `QueuePanel` are bodies; the `lyrics` store keeps only fetch state. The `'queue'` view and rail item are gone, so Back/Forward no longer records queue pages. `--lyrics-w` became `--panel-w`, and SearchView's card-grid freeze follows the panel rather than lyrics specifically.

Queue rows reorder from a Spotify-style grip that appears on hover or keyboard focus. Pointer Events (not HTML5 drag-and-drop) drive a 4px threshold, row rects cached in list coordinates, a drop line between rows, and rAF autoscroll near the panel edges; the queue changes once on release. The grip also reorders from the keyboard (ArrowUp/Down, Home/End) and refocuses the moved row, because rows stay index-keyed — the queue can hold the same track twice, and keying by id would either duplicate keys or remount covers. `player.move(from, to)` splices the array, keeps `index` on the current track so the highlight and "next" stay truthful, leaves audio untouched and persists the session. No new dependency. Autoplay stays a Settings option; the panel carries only the count and Clear.

Two alternatives were deliberately not taken: `svelte-dnd-action` is well maintained and accessible, but the project keeps exactly one runtime dependency and a single-list reorder is small enough to own; live reordering under the pointer needs stable queue ids or every row after the moved one remounts on each crossing. Both remain revisitable.

## 14. Library (shipped)

**Data.** `library.json` now holds `favorites`, `history` and **`playlists`**. A playlist is `{ id, name, createdAt, updatedAt, tracks[] }`; tracks are the same `Track` objects used by the player, so a playlist entry can open its artist, show its cover and play without another lookup. Malformed entries are dropped on read and healed on write, same policy as favourites.

**Store fix.** `JsonStore` used to debounce writes by 250ms — a quit inside that window silently lost the last change. It now writes synchronously (temp file + rename, a few KB per change). That also removed the need for the player's settings debounce.

**UI.**
- **Library** tab: *Liked songs* tile (with count), one tile per playlist (cover from its first track), and a *New playlist* tile that expands into an inline name field.
- **Collection page** for liked songs and each playlist: hero, Play all, Rename, Delete (two-step), track list with remove buttons, and Play all disabled when empty.
- **Add to playlist** on every track row: a library icon opens a single popover anchored to the row, listing playlists with counts plus "New playlist". One instance lives in the app root, so every surface (search, artist, album, song page) has it with no prop drilling.
- Deleting a playlist returns to the Library; removing a track from Liked songs unfavourites it.
- **Downloads live here too.** Downloaded albums appear as tiles, items carry a Downloaded or partial badge, and a **Downloaded** filter narrows the view. Standalone downloaded songs are listed below. See §17 for the full model.

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

### Multi-artist credits (2026-10-27)

A track credited to several artists only linked the first one. A search row knew every artist, but `toTrack` collapsed its parts into `artist` + one `artistId`, and the dock, song page and queue rendered that single id. The fix is a data shape that survives everywhere a Track is stored, not a renderer special case.

- `Track.artistParts` (`SubtitlePart[]`) is the source's credited run, separators included (`Stormy`, `, `, `Manal`). `artist` remains the display string. `HistoryEntry.artistParts` and `ImportTrack.artistParts` carry the same shape into history and YouTube imports.
- `src/shared/artist-credits.ts` is the single parser. `creditParts()` takes the leading run from a row's parts and stops at the album, a play counter or a duration; `artistPartsFor()` prefers stored parts and otherwise splits the display string; `isArtistName()` keeps connector words (`feat.`, `with`, `x`) out of the links.
- The fallback split is deliberately conservative: comma, spaced `&`/`+`, `feat.`/`ft.`/`featuring`/`with`, and spaced `x`. `R&B`, `AC/DC` and a trailing `X` stay whole. A split part carries no id, so clicking it searches that exact name — `openArtist()` now requires an exact normalized match before accepting the first result.
- Structured credits win everywhere: `toTrack`, the audio-swap path, the import matcher, YouTube playlist imports, downloads (`patchTrack`/`repairCredits`) and the history backfill keep or restore them. Old history and yt-dlp-resolved tracks are split at render time, and `recordHistory` stores the split so a replay from Recently played keeps every link.
- The dock, song page and queue render `ArtistLinks`, which links each name inline with the original separators and truncates the line. Track rows already rendered `CatalogItem.parts`; `trackToItem` now rebuilds them from `artistParts`, so playlists, downloads and Liked songs behave the same.

**B42 — "An object could not be cloned."** Adding `artistParts` made `Track` nested for the first time. Svelte 5 state is a deep proxy, and every IPC call structured-clones its arguments; the shallow `{ ...track }` snapshot from B14 now carried a proxied array, so favouriting, adding to a playlist, downloading, creating an imported playlist and the 3-second session save all threw. The session save failed silently as an unhandled rejection and repeated on every save during playback. `plainTrack()`/`plainParts()` (`src/renderer/lib/track.ts`) copy the credit array at every boundary — session, history, favourites, playlists, downloads, import — and `creditParts()` returns copies so catalog-derived tracks are plain to begin with. The `links` e2e toggles a favourite on a collaboration, and the `import` e2e creates a playlist, which both fail without this.

Regression: unit `artist-credits` and the featured-artist half of e2e `links`.

## 15. Lyrics (shipped)

**Source.** LRCLIB (`https://lrclib.net/api`), the only keyless source with reliable time-synced lyrics for music. `/get` first with artist, cleaned title, album and duration; on a miss, `/search` and pick the result closest in duration with synced lyrics preferred. `instrumental` is respected, and plain lyrics are the fallback. Results — including misses — are cached in `lyrics.json` (300 entries, misses retried after 24h), so a track is looked up once.

**Panel.** A docked right sidebar in the content row, `clamp(320px, 30vw, 380px)` wide. Opening expands a third grid column over 300ms and reflows the page; the titlebar and player bar stay full width. The panel uses the page background (`--bg`) with no raised surface and no backdrop blur; a single 1px `--stroke` hairline on its left marks where the page ends. Header shows `LYRICS · LRCLIB` and a close button. Synced lines fade at the top and bottom via a mask, the active line scales up and turns white, past lines dim to 45%. The list auto-centres: an instant jump on open, smooth scrolling on every line change. Clicking a line seeks to it.

**Trigger.** A lyrics button sits between the quality tag and the mute control in the player bar, marked active while the panel is open; it toggles. The panel reloads automatically when the track changes while open and is disabled when nothing is playing.

**Verified.** 80 synced lines for *Instant Crush*, cache hit in 0ms, unknown track → `none`; UI: panel opens (`open`, 80 lines, 1 active, `LRCLIB`), the content column shrinks by the panel width instead of being covered, clicking a lyric seeks, and closing restores the page width.

Deviation from the original plan: the YouTube `timedtext` fallback was dropped — it almost never exists for music, and `lyrics.ovh` now covers the plain-text backup.

### Lyrics polish

- **Docked layout (2026-10-23).** The panel moved from a fixed overlay to a third grid column in the content row. The track animates from `0` to `clamp(320px, 30vw, 380px)` over 300ms, so the page reflows instead of being covered; the titlebar and player bar stay full width. The inner panel keeps its final width while the track animates, so lyric lines do not re-wrap mid-slide. `visibility` is delayed by 300ms on close so the content is clipped rather than blinking out. The 32px backdrop blur was dropped because a docked panel has no page content behind it. The panel uses the same `--bg` as the page with no raised surface; a 1px `--stroke` hairline on its left is the only divider, replacing the old stronger border and surface step.
- **Responsive whole-card rails (2026-10-24).** Carousels stay horizontal, but never show a clipped card at the panel edge. A `fitRail` action (`src/renderer/lib/rail-fit.ts`) measures each rail's content box, chooses the integer number of card slots that fits, and writes `--rail-card-width`; `MediaCard`/`Cover` scale the artwork to that width. Slots are width-driven, so short shelves keep the same card size and leave slots open instead of stretching. Cards are sized to fill the content box exactly, with a 130–176px range: at 1420px with lyrics open Home shows 6 cards at 138.3px; at 920px it shows 3 at 148px; at 860px it shows 3 at 128px; closed at 1420px it shows 8 at 146.75px. Rails use `scroll-snap-type: x mandatory` with a 4px scroll padding, so manual scrolling also lands on whole cards. Applied to Home, Search's All rails, artist discography, and Offline Home; filtered Search results remain a fixed-width grid. The earlier flush-rail experiment and the panel's raised surface/strong border were removed — the page keeps its right gutter, and only a 1px `--stroke` hairline marks the panel edge.
- **Icon.** The microphone implied call muting; the button now uses a speech-bubble-with-lines glyph (Apple Music style).
- **Backup source.** If LRCLIB returns nothing (exact and search), `lyrics.ovh` is queried for plain text before giving up. "No lyrics" now means both sources came back empty. The result carries its source (`LRCLIB` / `lyrics.ovh`) in the panel header, and misses are still cached for 24h.
- **Line padding.** The active line's `scale(1.08)` is anchored to its left edge, so it stays aligned with every other line at the 22px inset. The container reserves the growth on the right (48px padding instead of 22px): the scaled box ends ~23px from the panel edge instead of overflowing it, and text still wraps at the same word boundaries when a line activates (no reflow jump). Inactive lines keep the 22px left inset; their wrap width is 8% narrower to provide the headroom. Verified with the longest line active: active and inactive text both start at x=823, the scaled box ends at 1156.7 against a panel edge of 1180, and `scrollWidth === clientWidth`.
- **Track change.** When the next song's lyrics load while the panel is open, the panel glides back to the top instead of snapping or inheriting the old position. The cached path reused the same `<div class="lines">`, so the previous song's scroll position (2809px at the end of *Instant Crush*) survived the track change and only moved once the new first line became active. The effect now watches the lyrics data object and starts `scrollTo({ top: 0, behavior: 'smooth' })` as soon as the new lyrics render — before the first timestamp — then centres the active line. Measured: starts at the clamped 1611px and settles at 0 in ~650ms. Regression: `lyrics-change` asserts both halves (it must not teleport; it must settle at the top).
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

Scenarios: `images`, `playback`, `reconnect`, `autoplay`, `links`, `lyrics`, `lyrics-change`, `library`, `resume`, `navigation`, `settings`, `offline`, `quick-search`, `import`. Each sets up its own state, runs silent, and restores volume/mute afterwards.


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
- Windows uses the same model with the `install_only_stripped` variant (`cpython-…-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`, extracted with tar — stripped ships no `.pdb` debug symbols: ~67 MB vs ~149 MB). `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` keep yt-dlp's JSON safe on cp1252 consoles; `PYTHONPYCACHEPREFIX` points at userData so bytecode never needs a writable app bundle.

**Why yt-dlp and not a JS extractor.** There is no maintained pure-JS equivalent. `youtubei.js` speaks InnerTube but must chase SABR/PO-token/signature changes and still needs segmented-audio handling; `ytdl-core`/`@distube/ytdl-core` break whenever YouTube changes and do not model the music catalog; `youtube-dl-exec` is a wrapper that runs a binary. yt-dlp is the only engine with the maintenance and breadth, so we ship its interpreter instead of replacing it.

**Settings** no longer shows yt-dlp. It is an implementation detail that updates itself; a user-facing "runtime" row was noise.


### Branding (2026-10-19)

- **Source artwork** lives at `assets/Logo.png` (1024²). `npm run icons` (`scripts/make-icons.py`) produces the platform icons: a 1024 PNG with the logo on the standard 824px rounded tile (transparent margin), `resources/icon.icns` via `iconutil`, and a 16–256px `resources/icon.ico` via Pillow.
- **Packaging** points `mac.icon` and `win.icon` at those files. The built bundle reports `CFBundleName`/`CFBundleDisplayName = Viby` and `CFBundleIconFile = icon.icns`; the `.icns` in the app matches `resources/icon.icns` byte for byte. The DMG/NSIS artifacts use the same icon.
- **Development** sets the Dock icon from `resources/icon.png` and installs a custom application menu (`src/main/menu.ts`) instead of Electron's default File/Edit/View menu. Edit roles are preserved so copy/paste still works in the search fields and inputs.
- **Menu name caveat:** macOS renders the first menu item with the *bundle* name, not the template label. Dev runs the `Electron.app` helper, so it still says "Electron"; the packaged app shows "Viby" (verified by screenshot: Apple / Viby / Edit / View / Window). Packaged Windows and Linux builds get no native menu bar — the custom titlebar is the chrome — while non-macOS development builds keep a minimal Edit/View menu for reload and DevTools. The packaged Windows executable takes its icon from `win.icon`.

## 17. Offline mode and downloads (shipped)

Status: shipped 2026-10-22 (`2059183`, `86abfe4`). P7a–P7c are complete; P7d's automated coverage is in place, and the Windows 11 manual offline/download pass is done on Electron 45. Windows 10 uses the same x64 build and is covered by that pass by maintainer decision. P7d's remaining manual edge cases are listed in §17.8. The specification below describes the current app.

### 17.1 The distinction that drives everything

| | Cache | Downloads |
|---|---|---|
| Purpose | Speed and bandwidth | Listening without a connection |
| Visibility | Invisible | Explicit, listed, badged |
| Control | Automatic | User |
| Eviction | LRU under a cap | Never |
| Clearing | "Clear cache" | "Remove download" |

Downloads are explicit, user-owned and permanent until the user removes them — or until the collection that owns them is deleted and no other reference remains. They live in **Library** with a clean badge and a Downloaded filter, Spotify-style; there is no separate Downloads page. A download hit is used before the cache; when a track becomes a download its cached copy is removed to avoid double storage (unless it is the file currently playing; then it is left for the next eviction). Clearing the cache never touches downloads, and removing downloads never touches the cache.

### 17.2 Locked decisions

- **Storage:** app-managed under `userData/downloads`. No folder picker, no exported files, no tag editing in v1.
- **Trigger:** automatic offline detection plus a manual offline switch.
- **Cache offline:** non-downloaded cached tracks play silently. No badge, no listing, no promise.
- **Scope:** songs, albums, playlists, Liked Songs. Liked Songs is a bulk action that downloads its tracks as individual songs, so unfavouriting never deletes a file.
- **Playlist deletion:** removes that playlist's download references; files with no remaining reference are deleted.
- **Defaults chosen for consistency:** no download cap; no auto-download of newly added tracks (tap Download again to fill gaps); download quality follows the playback quality at enqueue; downloads never sync with accounts; no export in v1.

### 17.3 Connectivity model

Main-process `NetworkMonitor`:

- `net.isOnline()` is polled every 5s, on startup and on `powerMonitor` resume; renderer `online`/`offline` events trigger an immediate re-check.
- `net.isOnline() === false` is authoritative offline. `true` is only a hint, so a transition to online is confirmed by a small `net.fetch` probe to `https://music.youtube.com/` (4s timeout; any HTTP response means reachable).
- States: `online`, `offline` (no link), `unreachable` (link up, host not answering), `forced-offline` (manual). Both `offline` and `forced-offline` enter offline mode. `unreachable` shows the same local-first layout with the "Cannot connect to the host" pill, the detail "Your connection works, but the host isn't responding.", and automatic re-probing — so a host outage does not produce a dead Home.
- Transitions are debounced (~2s); one failed probe does not flip the app. Failed catalog/resolve requests may report a hint, but HTTP 4xx/5xx and bot checks are not connectivity failures.
- Broadcast `network:changed` to renderers, with `network:get` and `network:setMode('auto' | 'offline')`. Manual mode persists in settings.
- A dev-only override (`VIBY_NETWORK_STATE`) forces each state for tests, independent of the machine's real network.

When effective offline and no local file exists, `resolveForPlayback` fails immediately with a `ResolveError('offline', …)` instead of spawning yt-dlp. No 10–60s DNS timeout.

### 17.4 UX specification

**Global**

- A compact titlebar status pill: "Offline", "Offline mode" or "Cannot connect to the host". Click opens a small menu with **Manage downloads** and either **Go online** (manual mode) or **Offline settings**. It is the only persistent offline chrome.
- Settings' Connectivity row is labeled **Offline mode** and explains the current state: automatic while connected, automatic with the connectivity reason when not, or manual with "Only downloads play" copy.
- Sidebar has **Library** (always present); downloads are part of it rather than a separate page. While local-first, Import is disabled with a tooltip, and Search opens an offline notice while the titlebar field is disabled — search needs the catalog.

**Home**

- Effective local-first replaces Home with the Offline Home. The status eyebrow reads "You're offline", "Offline mode" or "Cannot connect to the host"; the heading stays "Ready when you are."
- Sub: the download count, total size and free space when downloads exist; otherwise the connectivity detail (or "Downloads are the only things that play without a connection.").
- Actions: **Play downloads**, **Manage downloads**, and **Go online** in manual mode.
- Sections: Continue listening, Albums, Playlists, Songs.
- Empty state: "Nothing downloaded yet" with "Download songs, albums, playlists or Liked songs while online. They stay on this device and play with no connection." The action is **Find something** (or **Go online to download** in manual mode).
- "Manage downloads" opens Library, with the storage summary.
- Reconnecting refreshes Home and shows a brief "Back online" confirmation. It never yanks the user off a collection or Library.

**Library**

- Header filters: **All · Playlists · Albums · Downloaded**, with **New playlist** in All/Playlists.
- Tiles: Liked Songs, saved playlists, and downloaded albums (plus orphaned downloaded playlist snapshots). Downloaded playlists are not duplicated: their saved tile carries the badge.
- Badge: a small white check for a fully downloaded item, a progress ring with a download glyph for a partial item, and nothing when not downloaded. The same badge is reused on collection heroes.
- Downloaded songs section: standalone downloads that no downloaded collection owns, with size and row removal. Collection-owned songs never appear here or in a second list.
- Clicking a downloaded album opens its local-first collection page (cover, title, Play all, Remove download, per-song size/quality and remove). Clicking a saved playlist/Liked Songs always opens the normal collection page.
- Renders from snapshots in the download index, so it works offline even though artist/album pages need the network.
- Opening Library warms every saved cover and track thumbnail into `userData/cache/art`, so a playlist is not a grid of placeholders offline.

**Collection pages**

- Album, playlist and Liked Songs heroes get a Download action with states: Download · Download (n/m) · Downloading n/m · Downloaded. Clicking Downloaded removes the collection download after confirmation.
- When the link is offline (or manual mode is on), a saved playlist/Liked Songs still shows its full track list and cached artwork. Rows that are not downloaded fade to ~38% opacity, show "Not downloaded — unavailable offline" on hover, and are inert. Play all queues only the available rows and is disabled when none are.
- A downloaded album opens a local-first page with the same hero/play/track-row language as the online page, marked "Downloaded album/playlist/liked songs" and "Offline ready". It lists the songs actually on disk, with Remove download at the collection and row level; removing a row drops that reference and deletes the file only when nothing else owns it.
- Track rows get a download action/state in the existing hover cluster: idle, queued, downloading %, done, failed with retry. Downloaded rows keep a persistent check even offline.
- Deleting a playlist, or removing a track from it, prunes that playlist's references. The confirmation states how many downloaded songs will be deleted.

**Player and queue**

- Offline order: downloaded file → cached file → fail fast.
- A failed uncached track shows "You're offline. This song isn't downloaded." It does not auto-skip the whole playlist.
- Autoplay/radio warming is disabled offline; the queue stops at its end.
- Queue rows never expose cache state; downloads are marked.

**Settings**

- Cache copy stays automation language: "A rolling cache keeps playback smooth and sometimes works offline. Clearing it frees space but never touches your downloads."
- Downloads row: size, free space, Manage.
- Offline mode row.

### 17.5 Storage and data model

```
userData/downloads/
  index.json          entries, collection references, persisted jobs
  audio/<trackId>.<ext>
  art/<hash>.<ext>    offline covers (content-addressed)
  lyrics/<trackId>.json  lyrics pinned to a downloaded song
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
  /** Last reported total, so a retry can guard free space. */
  estimateBytes?: number
}
```

- The index is the truth for playback. An entry without a file is healed away; an orphan file with no entry is deleted on the next launch — which also finishes a removal whose file the OS still held open (Windows).
- References: a direct song download adds `track:<id>`; an album or playlist adds its key to every member; Liked Songs adds the `liked` source. Unfavouriting never prunes, and removing the Liked Songs download deletes only the files no other source still owns. Removing a reference deletes the entry/file only when `sources` is empty. "Remove download" in Library clears all sources for that track.
- Lyrics are part of a download: fetched when the song finishes and pinned under `downloads/lyrics/`, then served by the lyrics API before its offline check. Downloads made before this existed are backfilled the first time the app is online. Lyrics disappear with their entry.
- Collection snapshots keep offline grouping working; n/m is computed against the live library where it exists, otherwise the snapshot.
- Artwork is fetched at enqueue/download time through `net.fetch` (proxy-aware), size-capped, and served locally. A track with no thumbnail of its own borrows its downloaded collection's cover. Saved-library artwork also uses a content-addressed cache under `userData/cache/art` (separate from the audio cache, 256MB cap) and the same `viby-media://` scheme, so playlist covers and row thumbnails survive offline. The media scheme's MIME table includes images and restricts served paths to the cache/downloads roots.
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

**Feature modules**

- `src/main/network.ts` — monitor, probe, manual mode, broadcast
- `src/main/downloads/store.ts` — index, references, healing, stats
- `src/main/downloads/manager.ts` — queue, progress, retries, resume, disk guard
- `src/main/downloads/art.ts` — artwork fetch/cache for pinned downloads
- `src/main/cache/images.ts` — content-addressed saved-library artwork cache
- `src/renderer/lib/network.svelte.ts`, `src/renderer/lib/downloads.svelte.ts`
- `src/renderer/lib/download-groups.ts` — collection/loose-song split and offline artwork fallbacks
- `src/renderer/lib/library-items.ts` — unified Library tiles, download marks and progress
- `src/renderer/lib/artwork.svelte.ts` — resolve/warm library images through the cache
- `src/renderer/components/DownloadBadge.svelte`, `DownloadCollectionView.svelte`, `OfflineHome.svelte`

**Integrated files**

- `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts` — APIs and events
- `src/main/ipc.ts` — handlers, offline guard, download-first playback
- `src/main/library.ts` — prune references on playlist/track/like changes
- `src/main/cache/*` — skip downloaded; remove cache copy on download
- `src/renderer/lib/nav.svelte.ts`, `App.svelte`, `HomeView`, `DetailView`, `CollectionView`, `TrackRow`, `SearchBar`, `SettingsView`, `Queue`

Because this feature touches `src/shared/**` and `src/preload/**`, TESTING.md's escalation rule applies: targeted suites during development, the full set before release.

### 17.8 Delivery slices

**P7a — Offline awareness (no downloads yet). Shipped.**
Monitor, renderer store, manual toggle, offline pill, Offline Home empty state, offline states for Import/Search, fast offline playback failure, silent cache playback, autoplay off offline.
*Acceptance:* airplane mode at launch shows the offline Home instantly, with no error toast and no yt-dlp delay when pressing play on an uncached track; reconnecting restores Home.

**P7b — Download core. Shipped.**
Storage/index, manager, progress, per-song action, Library integration (songs + storage), playback priority, cache dedupe, persistence/resume, cancel/retry, disk guard, artwork for songs.
*Acceptance:* download a song, quit, relaunch offline, play it from Library; clearing cache leaves it untouched; cancel and retry work.

**P7c — Collections and polish. Shipped.**
Album/playlist/Liked actions with coverage and partial re-download; grouped Library with downloaded filters and badges; reference-based pruning; offline artwork for saved collections; faded unavailable rows; Search offline notice; settings copy; low-disk warnings; queue polish.
*Acceptance:* download a playlist and play it fully offline; a saved but undownloaded playlist still opens offline with cached art, all rows visible and non-downloaded rows faded; deleting the playlist removes only unreferenced files; a track shared with a downloaded album survives; Search shows the offline notice until the connection returns.

**P7d — Hardening. Manual edge cases pending.**
Offline e2e, failure-classification tests and docs are in place. The Windows 11 offline/download pass is done on Electron 45, and Windows 10 is covered by the same x64 build by maintainer decision. Network flapping, failed-download recovery, quit mid-download, long playlists, disk-full simulation and captive-portal handling still need the manual/packaged pass; automated tests do not replace it.

### 17.9 Test coverage

**Unit (`node tests/unit.mjs`):** `downloads-store` (index healing, reference add/remove, file deletion, path safety, disk guard), `downloads-manager` (queue state machine, progress parser, transient vs permanent failure classification, unknown totals, cache/download dedupe), `network` (state machine with injected `isOnline`/probe results and debounce), `download-groups`, `library-items`, `player-source`, `images`.

**E2E (`tests/e2e/offline.mjs`)** uses the manual switch, so it never depends on the machine's real network. It covers: local-first Home, the offline pill, disabled Import, the Charts page staying gone, the offline Search page, downloaded playback when the profile has a download, Library filters and badges, and reconnect. It deliberately does not download through yt-dlp.

**Manual/packaged pass:** download one short track and a collection, relaunch offline, play both; clear the cache and confirm downloads remain; delete a playlist and confirm only unreferenced files go; airplane mode on both platforms, Wi-Fi drop mid-download, quit mid-download, disk-full simulation, captive portal (`unreachable`). The Windows 11 pass is done on Electron 45; Windows 10 is covered by the same x64 build by maintainer decision. The remaining edge cases are the P7d items above.

### 17.10 Risks

| Risk | Mitigation |
|---|---|
| Storage bloat | Visible usage and free space, low-disk guard, easy deletion; no silent cap. |
| Progress format changes | One flag/parser module, tolerant of missing totals, indeterminate fallback, tests. |
| Offline detection false positives | `isOnline() === false` authoritative; online requires a probe; debounce; manual override. |
| Manual offline forgotten | Persistent titlebar pill, **Go online** in its menu, and the Settings switch. |
| Playlist deletion surprises | Reference counting and a confirmation that states how many songs will be deleted. |
| Cache/download duplication | Remove cache copy on download; skip background cache; download-first lookup. |
| Missing artwork offline | Store thumbnails at download time and serve locally. |
| yt-dlp failures | Per-track failure with reason, retry, batch continues; segmented formats are downloadable. |
| Long playlists / quit mid-download | Persisted queue, stable `.part` paths, resume, single concurrency. |
| Accounts/mobile confusion | Downloads are device-local and never synced; P6 accounts remain separate. |

### 17.11 Explicit non-goals (v1)

Exporting to Music/Finder, tag editing, download caps or quotas, auto-download rules, per-download quality overrides, syncing download state across devices, Android/SD-card storage, one-click artist discography downloads.
