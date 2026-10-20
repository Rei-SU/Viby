export type Track = {
  id: string
  title: string
  artist: string
  /** Browse id of the primary artist, so the player bar can link to them. */
  artistId?: string
  album?: string
  albumId?: string
  durationSec: number
  thumbnail?: string
  sourceUrl?: string
  views?: string
  videoType?: 'audio' | 'video' | 'ugc'
  /** Original catalog id when playback was swapped to the audio release. */
  sourceId?: string
}

/** A user-created playlist. Stored locally, like everything else in the library. */
export type Playlist = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  tracks: Track[]
}

/**
 * A playable stream. `kind: 'file'` means it is served from our bounded local
 * cache and will keep working offline; `kind: 'remote'` is a direct CDN URL that
 * is IP-bound and expires (PLAN §3, step 6).
 */
export type StreamInfo = {
  url: string
  kind: 'remote' | 'file'
  ext: string
  mime: string
  bitrateKbps?: number
  expiresAt: number
  cached: boolean
}

export type ResolveResult = {
  track: Track
  stream: StreamInfo
  /** Which YouTube player client produced the URL — useful when R1 bites. */
  client: string
  resolveMs: number
}

export type Repeat = 'off' | 'all' | 'one'
export type Quality = 'best' | 'data-saver'
export type SearchFilterName = 'all' | 'songs' | 'albums' | 'artists' | 'playlists'

export type Settings = {
  audioQuality: Quality
  cacheCapBytes: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: Repeat
  /** Keep playing related tracks when the queue runs out. */
  autoplay: boolean
}

export type CatalogKind = 'song' | 'album' | 'artist' | 'playlist' | 'unknown'

/**
 * A piece of a row's subtitle. Artist and album names carry the id of the page
 * they open, which is what makes them clickable.
 */
export type SubtitlePart = {
  text: string
  artistId?: string
  albumId?: string
}

/** A row that can be shown in search results, a shelf, or a track list. */
export type CatalogItem = {
  /** Playable video id for songs; browse id for albums/artists/playlists. */
  id: string
  /** Present when the item has its own page (album, artist, playlist). */
  browseId?: string
  kind: CatalogKind
  title: string
  subtitle: string
  /** Subtitle split into plain text and linked parts. */
  parts?: SubtitlePart[]
  thumbnail?: string
  durationSec?: number
  artists?: string[]
  /** Display string from YouTube, e.g. "1.2B plays". */
  views?: string
  /** YouTube's own classification: official audio vs a music video / upload. */
  videoType?: 'audio' | 'video' | 'ugc'
}

/** Page-level metadata returned alongside a browse result. */
export type BrowseHeader = {
  title: string
  subtitle?: string
  thumbnail?: string
  /** Artist pages: "71.8M" from YouTube Music's monthly audience. */
  monthlyListeners?: string
  /** Present when the header subtitle links to an artist. */
  artist?: { name: string; id: string }
}

export type BrowseResult = {
  items: CatalogItem[]
  header?: BrowseHeader
  /** Structured sections, e.g. Albums / Singles & EPs / Featured on. */
  shelves?: Shelf[]
}

/** A named group of items, e.g. a home-screen carousel. */
export type Shelf = {
  title: string
  items: CatalogItem[]
}

export type HistoryEntry = {
  trackId: string
  title: string
  artist: string
  /** Browse id of the artist, so history rows can link to them. */
  artistId?: string
  playedAt: number
  completion: number
  thumbnail?: string
}

export type LyricsLine = { time: number; text: string }

export type Lyrics = {
  kind: 'synced' | 'plain' | 'instrumental' | 'none'
  lines?: LyricsLine[]
  plain?: string
  source?: string
}

/** Restored on launch so you can pick up where you stopped. */
export type PlaybackSession = {
  track: Track | null
  queue: Track[]
  index: number
  position: number
  updatedAt: number
}

export type CacheStats = {
  bytes: number
  capBytes: number
  entries: number
  dir: string
}

export type YtDlpInfo = {
  path: string
  version: string
  /** `zipapp` runs under Python; `binary` is the slow fallback. */
  kind: 'zipapp' | 'binary'
  /** `bundled` is the shipping path; `system` is development-only. */
  runtime: 'bundled' | 'system' | 'binary'
}

export type Ok<T> = { ok: true; data: T }
export type Err = { ok: false; error: string }
export type Result<T> = Ok<T> | Err


/** Playlist import: one normalised track from any service. */
export type ImportService = 'spotify' | 'deezer' | 'youtube' | 'apple' | 'soundcloud'
export type ImportKind = 'playlist' | 'album' | 'track'

export type ImportTrack = {
  title: string
  artists: string[]
  album?: string
  durationSec?: number
  isrc?: string
  explicit?: boolean
  available?: boolean
  sourceId?: string
  sourceUrl?: string
  thumbnail?: string
  videoType?: 'audio' | 'video' | 'ugc'
  artistId?: string
  albumId?: string
}

export type ImportSource = {
  service: ImportService
  kind: ImportKind
  id?: string
  url?: string
  title: string
  creator?: string
  cover?: string
  totalTracks: number
  /** Set when a resolver could only return part of the list. */
  truncated?: { shown: number; total?: number }
  tracks: ImportTrack[]
}

export type ImportMatchStatus = 'auto' | 'review' | 'missing'

export type ImportMatch = {
  source: ImportTrack
  status: ImportMatchStatus
  score: number
  candidate?: Track
  candidates: Track[]
  reason?: string
}

export type ImportProgress = { done: number; total: number }

export type ImportCreateInput = { name: string; tracks: Track[] }
