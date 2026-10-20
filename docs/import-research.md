# Playlist import — research and implementation plan

Status: research complete, implementation not started.
Verified live on 2026-10-19 against public playlists (no accounts, no credentials).

## 1. Executive summary

All five services can be imported **without a user account**, but not equally well:

| Service | Anonymous source | Full playlist? | Risk |
|---|---|---|---|
| **Deezer** | Public REST API, no key | **Yes** — paginated `/playlist/{id}/tracks` | Low |
| **YouTube Music** | InnerTube `browse` (`WEB_REMIX`) | **Yes** — 100-track pages + continuations | Low/medium (API changes) |
| **Apple Music** | Share page's embedded `serialized-server-data` | **Yes** in testing (101-track playlist, 13-track album) | Medium (HTML scraping, no public API) |
| **SoundCloud** | Scraped web-player `client_id` + `api-v2` resolve | **Yes** — 416-track set returned in one response | Medium (client_id rotation, ToS) |
| **Spotify** | Anonymous embed token + web-player `fetchPlaylist` GraphQL | **Yes — public playlists**, 100/page | Medium (unofficial token/hash; public only; no ISRC). No Premium, no login, no server. |

Spotify's official Web API is Premium-gated for the app owner (February 2026), so we do not use it.
The **web player's own public GraphQL** still serves full public playlists from an anonymous token
found in the embed page. Verified live on 2026-10-19: 200 tracks in 2.85s, no Premium, no login, no
server. Implemented in `src/main/import/spotify.ts`. Private/collaborative playlists and Liked Songs
are not visible anonymously.

**Recommendation:** build link detection + the matcher + review screen first, then Deezer and YouTube
Music, then Apple, then SoundCloud, then Spotify (anonymous pathfinder). No file-drop UI: a normal
import is "paste the share link, watch it match, confirm". The text/CSV parser stays a development
fixture only.

## 2. What sharing actually looks like

Normalize before detection:

- trim whitespace, lowercase the host, drop fragments
- `spotify:playlist:<id>` / `spotify:album:<id>` / `spotify:track:<id>` URIs → web URLs
- strip tracking params: `si`, `utm_*`, `l`, `at`, `ct`
- follow redirects (max 5) for short domains, then inspect the final URL
- allow only `http(s)` (plus the `spotify:` URI form); cap response size (5 MB) and timeout (15 s)
- restrict the final host to an allowlist to avoid SSRF (a pasted link must not fetch `localhost`)

| Service | Canonical forms | Short forms | Notes |
|---|---|---|---|
| Spotify | `open.spotify.com/playlist/<22>`, `/album/<22>`, `/track/<22>`, optional `/intl-xx/` | `spoti.fi/<code>` | `?si=` ignored |
| Apple Music | `music.apple.com/<cc>/playlist/<slug>/pl.<32hex>`, `/album/<slug>/<numeric>?i=<numeric>` | `apple.co/<code>`, `geo.music.apple.com` | `?i=` means a single track |
| Deezer | `deezer.com/<lang>/playlist/<id>`, `/album/<id>`, `/track/<id>` | `deezer.page.link/<code>`, `link.deezer.com/s/<code>` | language prefix optional |
| YouTube Music | `music.youtube.com/playlist?list=<id>`, `youtube.com/playlist?list=<id>`, `music.youtube.com/watch?v=<v>&list=<id>` | `youtu.be/<v>` (single track) | `OLAK5uy_` = album, `RD` = infinite mix, `LL`/`WL` = private |
| SoundCloud | `soundcloud.com/<user>/sets/<slug>`, `/tracks/<slug>` | `on.soundcloud.com/<code>`, `m.soundcloud.com` | sets are albums/playlists |

Scope recommendation: accept **playlist, album and track** links. A track link imports a one-track
list; an album link imports the album. Reject artist/profile links with a clear message.

## 3. Live findings per service

### 3.1 Deezer — the easy one

```
GET https://api.deezer.com/playlist/908622995
→ 79 KB JSON, nb_tracks 50, tracks.data[0].title "Hey Jude (Remastered 2015)"
GET https://api.deezer.com/playlist/13839503761
→ nb_tracks 323, tracks.data length 323 (all inline)
GET https://api.deezer.com/playlist/13839503761/tracks?limit=100&index=0
→ 100 rows, total 323, next "...index=100"
```

- No `access_token` needed for catalog reads.
- Playlist objects **inline every track** in the tested 323-track case. Still page with
  `/tracks?limit=100&index=N` when `tracks.data.length < nb_tracks`.
- Track endpoint includes **ISRC** (`GBDUW0000059`), album, duration, explicit flag.
- Album endpoint returns all tracks (`/album/302127` → 14).
- Rate limit: **50 requests / 5 s** (documented baseline). Use ≤5 requests/s and back off on 429.
- Error bodies use `{ error: { type, message, code } }`; code 4 = quota, 700 = service busy.

### 3.2 YouTube Music — full, but needs continuations

```
POST /youtubei/v1/browse { browseId: "VLPLU0CpsviHWH2GP5FsdgOLYJ9hMLtclNpz" }
→ 100 musicResponsiveListItemRenderer rows + 1 continuationCommand token
POST /youtubei/v1/browse { continuation: "<token>" }
→ another 100 rows + another token
```

- Playlists of 50/86/59 returned all rows with no continuation; long lists return 100 + token.
- Our existing `extractItems()` already walks the response and finds rows; add a
  `continuationToken()` helper and a loop until no token.
- `extractHeader()` already handles `musicDetailHeaderRenderer` (playlist title/cover/owner).
- Prefixes: `PL` (user playlist), `OLAK5uy_` (album), `RD` (radio mix, **infinite — reject or cap**),
  `LL`/`WL` (private — reject with "this playlist is not public").
- Same endpoint works for `youtube.com/playlist?list=...` with the `WEB_REMIX` client.
- Each 100-track page is ~1 MB; 1,000 tracks ≈ 10 requests / 10 MB. Pace ~200 ms.
- Mapping is free: the rows are already the app's `CatalogItem` shape (videoId, artists, album,
  duration, videoType, thumbnail).

### 3.3 Apple Music — full HTML data, no public API

```
GET https://music.apple.com/us/playlist/rap-life/pl.abe8ba42278f4ef490e3a9fc5ec8e8c5
→ <script id="serialized-server-data">…</script>
→ sections: header(1), trackLockup(101), footer, related
```

Tested playlists: Today's Hits 50, Today's Country 78, Rap Life 101. Album *Random Access Memories*:
13 `trackLockup` items. A track link (`...?i=617154266`) still serves the whole album page; select the
item whose `contentDescriptor.identifiers.storeAdamID` matches `i`.

Useful fields per track:

```json
{
  "title": "Give Life Back to Music",
  "artistName": "Daft Punk",
  "duration": 274403,
  "trackNumber": 1,
  "contentDescriptor": {
    "kind": "song",
    "identifiers": { "storeAdamID": "617154353" },
    "url": "https://music.apple.com/us/album/…/617154241?i=617154353"
  },
  "tertiaryLinks": [{ "title": "Random Access Memories", "segue": { … album URL/ID … } }]
}
```

- Parse **only** `section.itemKind === "trackLockup"`; the page also contains `verticalVideoLockup` and
  `squareLockup` sections (music videos/related) that must not become tracks.
- Track IDs are numeric; **no ISRC** in the page. Match on title/artist/duration.
- Storefront is in the URL (`/us/`); fetch with that storefront. Titles are localized.
- The full list appeared server-rendered; test a 200–300-track user playlist before claiming no cap.
- No credentials; scraping a public share page. HTML changes are the main risk.

### 3.4 SoundCloud — client_id scrape + resolve

```
GET https://soundcloud.com/ → collect a-v2.sndcdn.com/assets/*.js
→ one bundle contains client_id:"bQmaW4vAHmJIUxisgjRG4MAWAiDgsk9D"
GET https://api-v2.soundcloud.com/resolve?url=<set>&client_id=<id>
→ kind "playlist", track_count 416, tracks length 416, next_href null
```

- The set resolve returned **all 416 tracks** in one response; no pagination observed.
- Track resolve gives title/user/duration/streamable/policy; no ISRC observed.
- `client_id` rotates: cache in memory + userData with a TTL (~12 h), refresh on 401/403, and treat a
  scrape failure as "SoundCloud import is temporarily unavailable" rather than a crash.
- Short links (`on.soundcloud.com`) redirect to the canonical set/track.
- Some tracks are geo-blocked/not streamable; flag them, don't drop them silently.
- Public API v2 is undocumented and ToS-sensitive; keep it best-effort and polite (1 req/s).

### 3.5 Spotify — anonymous web-player GraphQL (full public playlists)

The official Web API is Premium-gated for the app owner (Feb 2026, Development Mode 5 users,
Extended Quota enterprise-only). The web player's **public embed page** still contains an anonymous
access token, and its `fetchPlaylist` GraphQL returns full public playlists 100 at a time. This is the
keyless path used by [SpotifyScraper](https://github.com/AliAkhtari78/SpotifyScraper) (MIT, Ali
Akhtari); verified live 2026-10-19.

```
GET https://open.spotify.com/embed/playlist/<id>
→ __NEXT_DATA__ → props.pageProps.state.settings.session.accessToken (+ expiry)
→ props.pageProps.state.data.entity (title, cover, first 100 tracks as fallback)

GET https://api-partner.spotify.com/pathfinder/v1/query
  ?operationName=fetchPlaylist
  &variables={"uri":"spotify:playlist:<id>","offset":0,"limit":100,"enableWatchFeedEntrypoint":false}
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"a65e…cb4"}}
Headers: Authorization: Bearer <anonymous token>
         app-platform: WebPlayer
         browser User-Agent / Accept-Language

Response: data.playlistV2.content.totalCount + items[].itemV2.data
Fields: name, artists[].profile.name, albumOfTrack.name, trackDuration.totalMilliseconds,
        contentRating.label, playability.playable, uri
```

Verified: Rock Classics **200 tracks (2 pages) in 2.85s**; first `Dreams - 2004 Remaster` (258s,
*Rumours*), last `Would? (2022 Remaster)`. No ISRC, no release date.

- **Public playlists only.** Private/collaborative links are invisible to anonymous readers; Liked
  Songs has no public URL. A private playlist must be made public (or copied to a public playlist)
  before import.
- **Token is short-lived.** Re-bootstrap from the embed on expiry; cap retries.
- **The persisted-query hash can rotate.** Keep it in one constant (`src/main/import/spotify.ts`); on
  failure fall back to the embed's first 100 tracks. Update the hash from SpotifyScraper.
- **Unofficial / ToS-gray**, same category as yt-dlp; keep volume low and don't redistribute.
- **Track fields** are richer than the embed: structured artists, album, duration, explicit,
  playability. No ISRC.

### 3.6 Plain text / CSV — development fixture only

Not a user-facing feature (decision 2026-10-19). Keep a small parser in the test suite so the matcher
can be tested without network access; do not expose a file drop or paste-list screen.

## 4. Matching to YouTube Music

The hard part is not fetching the list; it is mapping 100 foreign tracks to the right YT Music
recordings. Build a **review screen** and never silently accept a weak match.

### 4.1 Normalization

- Unicode NFKD, casefold, collapse whitespace.
- Remove for comparison (keep the original for search):
  - `(feat. …)`, `[ft. …]`, `featuring …`
  - `- 2004 Remaster`, `(Remastered 2011)`, `(Deluxe Edition)`
  - `[Explicit]`, `(Official Video)`, `(Lyric Video)`, `(Visualizer)`
- Keep **version tokens** as a signal: `live`, `remix`, `acoustic`, `instrumental`, `karaoke`,
  `demo`, `radio edit`, `extended`, `sped up`, `slowed`, `reverb`. A version mismatch is a penalty,
  not a strip.
- Artists: keep the full string; derive a primary artist as the first segment before `,`/`&`/`feat.`
  for the search query. Compare both the full string and token overlap (do not split names like
  "Tyler, The Creator" for equality).
- Durations: normalize ms → seconds; allow ±2 s (rounded sources).

### 4.2 Scoring

```
titleSim    1.0 exact normalized; else token Jaccard × 0.7 + char similarity × 0.3
artistSim   1.0 primary equal; 0.8 one contains the other; 0.4 any token overlap; 0 none
durationSim 1 − min(1, |Δ| / 15)          // 0 at 15 s
version     −0.25 if live/remix/instrumental differs

score = 0.50·titleSim + 0.30·artistSim + 0.20·durationSim + version
```

- **Auto:** score ≥ 0.92, exact/near-exact title, artist overlap, duration Δ ≤ 3 s.
- **Review:** 0.60–0.92, or multiple close candidates, or a version mismatch.
- **Missing:** < 0.60 or no results.
- Prefer `videoType === 'audio'` (ATV); penalize `video`/`ugc`. Our search ranking already does this.
- **Album-level shortcut:** if the source is an album, search the album (`artist + album`, albums
  filter), browse the best album, then map by track number + duration. Accept the whole album only if
  its title/artist/track-count match. This is far more accurate than track-by-track for albums.

### 4.3 Cost and rate

- One YT Music search per track (~150–400 ms); concurrency 3, 150 ms spacing, retry/backoff on 429.
- 100 tracks ≈ 10–20 s. 1,000 tracks ≈ 2–4 min; progress + cancel are mandatory.
- Cache search results and source resolutions for the session.

## 5. Architecture

```
src/main/import/
  types.ts        ImportSource, ImportTrack, Match, Progress
  detect.ts       URL/URI normalization, allowed hosts, redirect resolution
  http.ts         fetch wrapper: UA, timeout, size cap, retries, no cookies
  index.ts        resolve(url) → source; match(source) → job; create(playlist)
  text.ts         plain text / CSV
  deezer.ts       API, paging, ISRC
  youtube.ts      browse + continuation loop
  apple.ts        serialized-server-data parser
  soundcloud.ts   client_id cache + resolve
  spotify.ts      embed parser + truncation total
  matcher.ts      normalization, scoring, search, album matching
src/renderer/components/ImportView.svelte     paste + source preview + review
src/renderer/lib/import.svelte.ts             job/progress state
```

### 5.1 Types

```ts
type ImportService = 'spotify' | 'apple' | 'deezer' | 'youtube' | 'soundcloud' | 'text'
type ImportKind = 'playlist' | 'album' | 'track'

type ImportTrack = {
  title: string
  artists: string[]
  album?: string
  durationSec?: number
  isrc?: string
  explicit?: boolean
  sourceId?: string
  sourceUrl?: string
  trackNumber?: number
  available?: boolean
}

type ImportSource = {
  service: ImportService
  kind: ImportKind
  id?: string
  url?: string
  title: string
  creator?: string
  cover?: string
  totalTracks: number
  truncated?: { shown: number; total: number }
  tracks: ImportTrack[]
}

type Match = {
  source: ImportTrack
  status: 'auto' | 'review' | 'missing'
  score: number
  candidate?: Track        // chosen YT Music track
  candidates: Track[]      // top 3 alternatives
  reason?: string
}
```

### 5.2 IPC

```
import:resolve  (url)            → Result<ImportSource>
import:match    (source)         → jobId, emits import:progress { done, total, phase }
import:cancel   (jobId)
import:create   ({ name, tracks }) → Result<Playlist>
```

The source list stays in the main process for the duration of the job. Progress events are throttled
(e.g., one per track) instead of sending 100 IPC messages per second.

### 5.3 Review UX

- Source header: cover, service, title, creator, "101 tracks" (or "Showing 100 of 200" warning).
- Rows: source title/artist/duration → status → chosen candidate; expanding shows 3 alternatives with
  album + duration, "Search manually", "Skip".
- Bulk: "Accept all suggested" (auto only), "Import N tracks"; review rows must be resolved first.
- Failure states are explicit: private, unavailable, region-blocked, truncated, rate-limited.
- Create playlist with the source title; preserve order; dedupe identical YT ids with a warning.

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Spotify token/hash rotation | Hash in one constant; fallback to the embed's first 100; update from SpotifyScraper. |
| Spotify private/collaborative | Explicit "make it public" message; anonymous readers cannot see it. |
| Apple HTML structure changes | Parse by `itemKind: trackLockup` and `contentDescriptor`, not CSS; fixtures. |
| Apple regional/localized titles | Fetch the link's storefront; match with duration + artist; review screen. |
| Deezer rate limit | 5 req/s limiter, exponential backoff, page size 100. |
| YT Music continuation expiry | Fetch pages sequentially with the token; restart once on 400. |
| YT mix links (`RD…`) | Reject as "radio mixes are infinite"; user can paste a playlist. |
| SoundCloud client_id rotates | Cache + refresh on 401/403; clear error + text fallback. |
| Private/region-blocked playlists | Explicit error; never an empty review screen. |
| Legal/ToS | Personal use, public links only, no credentials, polite rates, plain-text floor. |

## 7. Test plan

- **Fixtures** (captured from the live responses, trimmed):
  - Spotify embed HTML (playlist/album/track) + full-page `initialState` for the total.
  - Apple serialized data (playlist 101, album 13, track `?i=`).
  - Deezer playlist (inline + paged) and a track with ISRC.
  - YouTube Music browse (100 rows + token) and a continuation.
  - SoundCloud set (2 tracks) + a client_id scrape.
  - Text/CSV samples.
- **Unit:** each parser against fixtures; detector table (every URL form + short redirect mock);
  scorer thresholds (exact, remaster, live mismatch, duration mismatch); truncation math.
- **E2E:** paste a 10-line text list → review → accept → playlist exists in the library with the right
  order. No network.
- **Live, opt-in:** resolve one public playlist per service and assert track counts/titles; never part
  of the default suite.
- **Manual acceptance:** import a 100-track Deezer playlist in <60 s; Spotify 200-track warns; cancel
  mid-match leaves no partial playlist.

## 8. Effort

| Part | Estimate |
|---|---|
| Types, URL detection, HTTP/allowlist/retries, limiter | 0.5–1 day |
| Text/CSV parser | 0.5 day |
| Matcher + scoring + album matching + progress/cancel | 1–1.5 days |
| Review UI + Import page rewrite | 1–1.5 days |
| Deezer adapter | 0.5 day |
| YouTube Music adapter + continuations | 0.5–1 day |
| Apple adapter | 0.5–1 day |
| SoundCloud adapter + client_id cache | 0.5–1 day |
| Spotify adapter + truncation detection | 0.5–1 day |
| Fixtures, unit tests, e2e, polish | 1–2 days |
| **Total** | **~7–9 focused days** |

## 9. Recommended sequence

1. **Link flow:** detection + matcher + review screen + create playlist.
2. **Deezer** and **YouTube Music** — the two lowest-risk full imports.
3. **Apple** — full data, HTML parser risk.
4. **SoundCloud** — client_id risk.
5. **Spotify** — anonymous pathfinder (public playlists), embed fallback (100).

## 9.1 Decisions (2026-10-19, final)

- **No file drop / CSV UI.** Import is paste-a-link only.
- **Spotify:** anonymous **web-player pathfinder** (embed token + `fetchPlaylist` GraphQL). Full
  public playlists, 100/page; no Premium, no login, no server, no Supabase. Fallback to the embed's
  first 100 if the token/hash rotates. Private/collaborative/Liked Songs are not available
  anonymously. No ISRC.
- **Deezer, YouTube Music, Apple, SoundCloud:** full native adapters.
- **Build order:** link detection + matcher/review → Deezer + YouTube Music → Apple → SoundCloud →
  Spotify (anonymous pathfinder).

## 10. Open decisions

- **Spotify private/collaborative playlists:** public-only by design. Document "make it public or
  copy it to a public playlist" in the import error. Liked Songs has no public URL.
- **Scope:** playlists only, or playlists + albums + tracks? (Recommendation: all three.)
- **Review depth:** candidate picker + manual search, or auto-match + skip only? (Recommendation:
  candidate picker; silent mismatches are worse than a slower import.)
- **Privacy:** the importer fetches user-pasted links from main; no telemetry, no cookies, no accounts.
  Confirm the allowlist hosts before implementation.
