# Performance work handoff

**Written:** 2026-10-26 on `main`, packaged x64 build, Electron 45.0.0, Intel Mac (macOS 15.7.7, 8 GB RAM).

**Status (2026-10-27):** superseded as a plan. The 1 Hz clock throttle, the measurement-harness fixes and the Electron 45 baseline below all shipped; [PLAN.md](PLAN.md) §6 is the canonical record. This file is kept for the harness gotchas and the attribution evidence.

**Branch note:** this was written on `main`, which has since moved to 0.2.4. `home-redesign` diverged at `7f06952` and does **not** contain `main`'s newer commits — including the taskbar-preview playback controls (`d698227`), mouse back/forward navigation, wheel volume, the repeat-mode icon and the 0.2.3–0.2.4 releases. Do not read the branch/push state below as current.

**Goal (historical):** reduce resource use of the packaged app. The immediate target was <5% CPU while playing.

The 1 Hz player-clock win is done. The remaining work is the lyrics panel and, if the `<5%` target must be met, the live scrubber.

## TL;DR

- Chromium fires `timeupdate` about 4×/s. Every tick was updating the progress bar, clock, Svelte state and OS media session, forcing layout/style recalc and re-compositing the glass dock. That cost ~4 points of CPU.
- The player now mirrors the clock to the UI and media session **at most once per second**. Playing CPU: **11.97% → 7.63%**. Idle: **0.39%**. Lyrics: **12–18%**.
- The `<5%` playing target is **not met** and is not reachable on this Intel Mac with a visible live scrubber. The floor is **5.23%** with the scrubber hidden and 1 Hz updates; the scrubber adds ~2.8 points.
- The lyrics panel is the largest remaining consumer. It is dominated by smooth scrolling and a masked, composited layer, not by JavaScript.
- The measurement harness was fixed: display sleep and window occlusion were producing impossible numbers. It now keeps the display awake, raises the app, counts CPU per PID, and fails if playback never starts.

## Commits

These landed on `main`; the original local-history caveat no longer applies.

```
8e8548b docs: record the Electron 45 performance baseline
c67211d fix(measure): keep the display awake and count CPU per PID
d795804 perf(player): throttle clock and media-session updates to 1 Hz
```

Pre-existing and still unpushed: `efd434f`, `46f5739`.

## What changed

### `src/renderer/lib/player.svelte.ts`

- Added `private lastPositionUpdateAt = 0`.
- Added `private updatePosition(force = false, saveNow = false)`:
  - returns if there is no `loadedId`,
  - throttles non-forced calls to 1 Hz,
  - sets `this.position = audio.currentTime`,
  - calls `syncPositionState()` and `persistSession(saveNow)`.
- `audio.ontimeupdate` now calls `updatePosition()`.
- `audio.onplay` calls `updatePosition(true)`.
- `audio.onpause` captures `wasPlaying`, then calls `updatePosition(true, true)` when it was playing, so the exact stop point is saved.
- `audio.onloadedmetadata` calls `syncPositionState()` once the duration is known.
- `seek()` updates and saves immediately and resets the throttle timestamp.
- Track resets in `start()` and the import `play()` path reset `lastPositionUpdateAt`.
- Lyrics active-line cadence is now 1 Hz. See “Design notes”.

### `scripts/measure.mjs`

- CPU is accumulated from **per-PID deltas** in `sample()` and in the soak. The old summed `cputime` could go negative when a helper exited mid-sample.
- Added `caffeinate -dimsu` plus a one-shot `caffeinate -u -t 1` to wake and hold the display awake. An exit handler kills the child.
- Added `activate()` via `osascript` before each sample.
- The idle sample now starts **60 s after load**, matching PLAN §6. At 25 s the tail of Home’s artwork/shelf refresh still showed 3%+ CPU.
- The playback trigger now clicks `.card .card-hit`; clicking the card shell no longer starts audio.
- The script **throws** if playback never starts instead of reporting idle numbers as “playing”.
- Soak CPU uses per-PID deltas too.

### `PLAN.md` §6

- Replaced the Electron 37 baseline with the Electron 45 numbers, the 1 Hz win, the 5.23% floor and the remaining lyrics cost.
- Updated the “no UI polling” bullet to mention the 1 Hz throttle.

## Measured baseline (packaged x64, Electron 45, Intel Mac)

| State | RSS | CPU |
|---|---|---|
| Idle (Home, 60 s after load) | 373 MB (373–374) | 0.39% |
| Playing, window frontmost | 434 MB (422–448) | **7.63%** (renderer 4.0%, GPU 1.7%, utility 1.1%, main 0.9%) |
| Playing + lyrics | 466 MB (451–474) | **12–18%** (renderer 8.4%, GPU 7.4% in the 17.7% sample) |
| Paused after playback | 455 MB | 0.77% |
| Soak (2 min, lyrics open) | 452 → 455 MB | 11.61% |

- **Startup:** page 560–731 ms, shell 755–1106 ms, Home cards 755–1238 ms on warm launches. The first launch after a fresh unsigned build can take ~4 s while macOS scans the bundle.
- **Bundle:** 425 KB JS + 92 KB CSS raw = **100 KB gzip**.
- **Before the change:** playing 11.97% (renderer 5.6%, GPU 4.0%, main 1.3%, utility 1.1%); lyrics 14.30%.
- **Lyrics variance:** 11.99% and 17.71% in two official runs, 16.51% in a separate probe. It depends on the song and on where the smooth-scroll animation happens to be. Do not quote a single fixed number.

## Attribution evidence

- Hiding `.dock`: 12.02% → 6.20%.
- Hiding `.scrub`: 6.30%.
- Hiding only the seek input: 12.20%; hiding only the time labels: 12.49% (no help).
- `backdrop-filter` off: 10.19%; no animations: no meaningful change; titlebar/content/sidebar hidden: no meaningful change.
- Layer containment, `will-change`, moving the scrubber out of the dock, and a custom transform-based fill: no meaningful win.
- JS profile: almost entirely idle. The cost is layout/style recalc/compositing.
- 1 Hz `ontimeupdate` + scrub hidden: **5.23%** (renderer 3.20%, utility 1.07%, main 0.87%, GPU 0.10%).
- `setPositionState` noop reduced main CPU 1.37% → 0.24%.
- 1 Hz throttling reduced `RecalcStyleCount` 39 → 10 and `LayoutCount` 21 → 10 per sample.

## How to reproduce

```bash
npm run typecheck
node tests/unit.mjs

# packaged measurement (macOS only)
npm run dist:dir             # rebuilds dist/mac/Viby.app
npm run measure              # ~5 min; keeps the display awake
npm run measure -- --quick   # skips the 2-min soak, one startup launch
```

E2E needs the dev app with CDP:

```bash
VIBY_DEBUG_PORT=9222 npm run dev
# in another terminal:
node tests/e2e/run.mjs playback resume lyrics lyrics-change
node tests/behaviour.mjs
```

Verified after the change: `npm run typecheck`, `node tests/unit.mjs`, `node tests/behaviour.mjs`, and e2e `playback`, `resume`, `lyrics`, `lyrics-change`.

## Environment gotchas

1. **Display sleep is 2 minutes on this machine.** A sleeping or occluded display makes macOS throttle the renderer and purge its surfaces. Numbers become too low (playing CPU below the 5.2% floor) and RSS can shrink mid-soak. `measure.mjs` now handles this; any new harness must too.
2. **The app must be frontmost.** `activate()` uses `tell application id "com.viby.app" to activate`. Terminal or another app stealing focus invalidates a sample.
3. **The first launch after a fresh unsigned build is slow.** ~4 s once; warm launches are 0.5–0.7 s to page. Do not treat that as a regression.
4. **Dev and packaged apps share userData** (`~/Library/Application Support/viby`). E2E runs can leave history entries and settings behind. The harness forgets synthetic titles, but scenarios using real tracks (`lyrics-change`) do not. If an auto-advance e2e fails, check `player.repeat` first: profiling can leave it on `one`.
5. **CDP port 9222 must be free.** Kill stale `Viby`/`Electron` processes before launching the packaged app or the dev server.
6. **The measure script plays the first Home card.** If Home is empty or the first card is not playable, it throws. A more robust version would search for a known track or pick from Quick picks.
7. **Do not push.** The user has not asked for a push. Windows 10 is closed by decision (covered by the Windows 11 x64 pass). macOS signing/notarization is deferred indefinitely.

## Next steps (prioritized)

### 1. Lyrics panel — largest remaining consumer

Current: 12–18% with lyrics open; renderer 8.4%, GPU 7.4% in the high sample. The player clock is already 1 Hz, so this is the panel itself.

Suspects in `src/renderer/components/LyricsPanel.svelte`:

- `listEl.scrollTo({ top, behavior: 'smooth' })` on every active-line change.
- `-webkit-mask-image` / `mask-image` gradient on `.lines`, which forces a composited layer.
- Active-line `transform: scale(1.08)` plus color/opacity transitions.

Experiments to run with the packaged app + CDP (or a temporary CSS override):

1. Disable the mask (`mask-image: none`) and measure.
2. Replace smooth scrolling with instant (`behavior: 'auto'`) or a transform-based offset and measure.
3. Remove the active-line transform transition and measure.
4. If the mask is the cost, consider a static gradient overlay instead of a mask, or apply the mask only while the panel is open and the window is visible.

Do not assume the 1 Hz clock helps here; it may make each smooth scroll more visible. Measure each variant and keep only what wins.

### 2. Scrubber / `<5%` target

The live progress bar adds ~2.8 points even at 1 Hz. The floor with it hidden is 5.23%. Options:

- Accept the target as unreachable on this Intel Mac and document it (already done in PLAN §6).
- Update the progress bar less often (e.g., every 2–5 s or only on whole-percent changes) and measure.
- Replace the native range input’s gradient fill with a transform-only fill. A previous custom-div attempt did **not** win, so re-test carefully.
- Remove the live progress bar in favour of a static track plus elapsed time (UX trade-off).

### 3. Memory headroom (optional)

Idle is 373 MB with 27 MB under the 400 MB ceiling. Playing/lyrics are 434/466 MB, but the budget caps idle only. If more headroom is wanted:

- `content-visibility` / `contain-intrinsic-size` on long lists and off-screen shelves.
- Smaller cover URLs for small UI sizes (`Cover.svelte` uses the source URL as-is; the parser picks the largest thumbnail).
- Clear closed lyrics data / release large buffers when the panel closes.
- Re-check the art and audio caches’ eviction behaviour.

## Design notes / invariants

- `updatePosition(force, saveNow)` is the single place that copies `audio.currentTime` into `position`. Do not reintroduce direct writes in `timeupdate`; that brings back the 4 Hz churn.
- Pause/seek must persist the exact position. `onpause` only saves when `wasPlaying` is true because track changes pause the old element programmatically after `this.playing` has already been set false. Keep that ordering.
- `onloadedmetadata` syncs the OS position but must **not** overwrite `this.position` from `audio.currentTime`: on a restored session the seek may not have applied yet, and reading it there can jump the UI to 0.
- The lyrics active line now updates at 1 Hz. If that feels too coarse, decouple the lyrics clock from the scrubber/media-session clock rather than raising the global rate.
- `persistSession` is already throttled to one write per 3 s; the 1 Hz `updatePosition` call does not increase disk writes.

## Files to read first

- `src/renderer/lib/player.svelte.ts` — throttle implementation.
- `src/renderer/components/PlayerBar.svelte` — `.scrub`, progress derivation, dock.
- `src/renderer/components/LyricsPanel.svelte` — scroll, mask, active line.
- `src/renderer/styles/global.css` — range input track/thumb styling.
- `scripts/measure.mjs` — measurement harness.
- `PLAN.md` §6 — budget and baseline.
- `tests/e2e/playback.mjs`, `tests/e2e/resume.mjs`, `tests/e2e/lyrics.mjs`, `tests/e2e/lyrics-change.mjs` — timing-sensitive coverage.
- `tests/behaviour.mjs` — queue, repeat, media session, history.

## Suggested first commands

These were the handoff-machine steps; `dist:dir` and `measure` are macOS-only, and the current branch is `home-redesign`.

```bash
git log --oneline -5
npm run typecheck
npm run dist:dir
npm run measure
```

Then open `LyricsPanel.svelte` and start the mask/scroll experiments — still the largest remaining CPU consumer on the Intel Mac.
