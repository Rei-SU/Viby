import { randomUUID } from 'node:crypto'
import { JsonStore, userDataFile } from './json-store'
import type { HistoryEntry, Playlist, SavedAlbum, Track } from '@shared/types'

type LibraryData = {
  favorites: Track[]
  history: HistoryEntry[]
  playlists: Playlist[]
  albums: SavedAlbum[]
}

const MAX_HISTORY = 5000

/**
 * A batch of remote changes, applied in one store write. Account sync uses this
 * so a pull of five hundred records does not rewrite library.json five hundred
 * times.
 */
export type RemoteLibraryOps = {
  favorites?: { upsert?: Track[]; remove?: string[] }
  playlists?: { upsert?: Playlist[]; remove?: string[] }
  /**
   * One playlist entry. A playlist's tracks sync as individual records so two
   * devices can add or remove different songs without replacing the whole list.
   */
  playlistItems?: {
    upsert?: Array<{ playlistId: string; track: Track; position: number }>
    remove?: Array<{ playlistId: string; trackId: string }>
  }
  albums?: { upsert?: SavedAlbum[]; remove?: string[] }
  history?: { upsert?: HistoryEntry[]; remove?: Array<{ trackId: string; playedAt: number }> }
}

/**
 * A single malformed stored entry used to break every favourite toggle: the
 * lookup callback does `t.id`, so one `null` in the array throws for all calls.
 * Validate on the way in and heal on the way out.
 */
function isValidTrack(value: unknown): value is Track {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Track).id === 'string' &&
    (value as Track).id.length > 0
  )
}

function isValidHistoryEntry(value: unknown): value is HistoryEntry {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as HistoryEntry).trackId === 'string' &&
    (value as HistoryEntry).trackId.length > 0
  )
}

function isValidPlaylist(value: unknown): value is Playlist {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Playlist).id === 'string' &&
    typeof (value as Playlist).name === 'string' &&
    Array.isArray((value as Playlist).tracks)
  )
}

/** Give every entry a distinct order value, using the current array order. */
function normalizeTrackPositions(playlist: Playlist): void {
  const missing = playlist.tracks.some(
    (track) =>
      typeof track.playlistPosition !== 'number' || !Number.isFinite(track.playlistPosition)
  )
  const unique = new Set(playlist.tracks.map((track) => track.playlistPosition)).size
  if (!missing && unique === playlist.tracks.length) return
  playlist.tracks.forEach((track, index) => {
    track.playlistPosition = index
  })
}

function isValidSavedAlbum(value: unknown): value is SavedAlbum {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as SavedAlbum).id === 'string' &&
    (value as SavedAlbum).id.length > 0 &&
    typeof (value as SavedAlbum).title === 'string' &&
    (value as SavedAlbum).title.length > 0
  )
}

/**
 * Favorites, history and playlists are local-first by design (PLAN §5.4): with no
 * account behind them they cannot be taken away by an upstream change.
 */
export class Library {
  private store: JsonStore<LibraryData>

  constructor(file = userDataFile('library.json')) {
    this.store = new JsonStore<LibraryData>(file, {
      favorites: [],
      history: [],
      playlists: [],
      albums: []
    })
    const data = this.store.get()
    if (
      !Array.isArray(data.favorites) ||
      !Array.isArray(data.history) ||
      !Array.isArray(data.playlists) ||
      !Array.isArray(data.albums)
    ) {
      this.store.update((next) => {
        if (!Array.isArray(next.favorites)) next.favorites = []
        if (!Array.isArray(next.history)) next.history = []
        if (!Array.isArray(next.playlists)) next.playlists = []
        if (!Array.isArray(next.albums)) next.albums = []
      })
    }
  }

  /**
   * True when library.json could not be parsed and this run is on empty
   * defaults. Sync must never read that emptiness as "the user deleted
   * everything"; the file is kept for recovery instead.
   */
  get loadFailed(): boolean {
    return this.store.loadFailed
  }

  favorites(): Track[] {
    const stored = Array.isArray(this.store.get().favorites)
      ? this.store.get().favorites
      : []
    const valid = stored.filter(isValidTrack)
    if (valid.length !== stored.length) {
      this.store.update((data) => {
        data.favorites = valid
      })
    }
    return valid
  }

  isFavorite(trackId: string): boolean {
    return this.favorites().some((t) => t.id === trackId)
  }

  toggleFavorite(track: Track): { favorited: boolean; favorites: Track[] } {
    if (!isValidTrack(track)) return { favorited: false, favorites: this.favorites() }

    const favorites = this.favorites()
    const existing = favorites.some((t) => t.id === track.id)
    const next = existing
      ? favorites.filter((t) => t.id !== track.id)
      : [{ ...track }, ...favorites]

    this.store.update((data) => {
      data.favorites = next
    })

    return { favorited: !existing, favorites: next }
  }

  addHistory(entry: HistoryEntry): void {
    if (!isValidHistoryEntry(entry)) return
    this.store.update((data) => {
      if (!Array.isArray(data.history)) data.history = []
      // One entry per play: the player writes it once the listening threshold
      // is met, then updates that same row when the play pauses or ends.
      const at = data.history.findIndex(
        (row) => row.trackId === entry.trackId && row.playedAt === entry.playedAt
      )
      if (at >= 0) {
        data.history[at] = entry
        return
      }
      data.history.unshift(entry)
      if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY
    })
  }

  /** Test harness only: drop synthetic titles so they never look like listening. */
  removeHistory(titles: string[]): number {
    if (titles.length === 0) return 0
    const drop = new Set(titles)
    let removed = 0
    this.store.update((data) => {
      if (!Array.isArray(data.history)) data.history = []
      const before = data.history.length
      data.history = data.history.filter((entry) => !drop.has(entry.title))
      removed = before - data.history.length
    })
    return removed
  }

  history(limit = 100): HistoryEntry[] {
    const history = this.store.get().history
    return (Array.isArray(history) ? history : []).filter(isValidHistoryEntry).slice(0, limit)
  }

  /** Feeds the cache-worthiness rule in cache/policy.ts. */
  playCount(trackId: string): number {
    return this.history(5000).filter((h) => h.trackId === trackId).length
  }

  bestCompletion(trackId: string): number {
    let best = 0
    for (const h of this.history(5000)) {
      if (h.trackId === trackId && h.completion > best) best = h.completion
    }
    return best
  }

  // ---- saved releases ----------------------------------------------------

  albums(): SavedAlbum[] {
    const value = this.store.get().albums
    const stored = Array.isArray(value) ? value : []
    const valid = stored.filter(isValidSavedAlbum)
    if (valid.length !== stored.length) {
      this.store.update((data) => {
        data.albums = valid
      })
    }
    return [...valid].sort((a, b) => b.savedAt - a.savedAt)
  }

  isAlbumSaved(id: string): boolean {
    return this.albums().some((album) => album.id === id)
  }

  /** Save or unsave one release; a repeat save is a no-op replacement. */
  toggleAlbum(album: SavedAlbum): { saved: boolean; albums: SavedAlbum[] } {
    const current = this.albums()
    if (!isValidSavedAlbum(album)) return { saved: false, albums: current }

    const existing = current.some((entry) => entry.id === album.id)
    const next = existing
      ? current.filter((entry) => entry.id !== album.id)
      : [{ ...album, savedAt: Date.now() }, ...current]

    this.store.update((data) => {
      data.albums = next
    })
    return { saved: !existing, albums: next }
  }

  // ---- playlists ---------------------------------------------------------

  playlists(): Playlist[] {
    const value = this.store.get().playlists
    const stored = Array.isArray(value) ? value : []
    const clean = stored
      .filter(isValidPlaylist)
      .map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter(isValidTrack) }))

    // Older libraries have no order values. Give each entry its array index
    // once; later adds keep using values so the order survives sync.
    let normalized = false
    for (const playlist of clean) {
      const missing = playlist.tracks.some(
        (track) =>
          typeof track.playlistPosition !== 'number' || !Number.isFinite(track.playlistPosition)
      )
      const unique = new Set(playlist.tracks.map((track) => track.playlistPosition)).size
      if (missing || unique !== playlist.tracks.length) {
        playlist.tracks.forEach((track, index) => {
          track.playlistPosition = index
        })
        normalized = true
      }
    }

    const changed =
      normalized ||
      clean.length !== stored.length ||
      clean.some((playlist, i) => playlist.tracks.length !== (stored[i]?.tracks?.length ?? 0))

    if (changed) {
      this.store.update((data) => {
        data.playlists = clean
      })
    }

    return [...clean].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  playlist(id: string): Playlist | null {
    return this.playlists().find((playlist) => playlist.id === id) ?? null
  }

  createPlaylist(name: string): Playlist {
    const now = Date.now()
    const playlist: Playlist = {
      id: randomUUID(),
      name: name.trim() || 'New playlist',
      createdAt: now,
      updatedAt: now,
      tracks: []
    }

    this.store.update((data) => {
      data.playlists = [playlist, ...(data.playlists ?? [])]
    })

    return playlist
  }

  renamePlaylist(id: string, name: string): Playlist | null {
    const trimmed = name.trim()
    if (!trimmed) return this.playlist(id)

    let updated: Playlist | null = null
    this.store.update((data) => {
      const playlist = (data.playlists ?? []).find((p) => p.id === id)
      if (!playlist) return
      playlist.name = trimmed
      playlist.updatedAt = Date.now()
      updated = { ...playlist, tracks: [...playlist.tracks] }
    })
    return updated
  }

  deletePlaylist(id: string): void {
    this.store.update((data) => {
      data.playlists = (data.playlists ?? []).filter((playlist) => playlist.id !== id)
    })
  }

  addToPlaylist(playlistId: string, track: Track): Playlist | null {
    if (!isValidTrack(track)) return null

    let updated: Playlist | null = null
    this.store.update((data) => {
      const playlist = (data.playlists ?? []).find((p) => p.id === playlistId)
      if (!playlist) return
      normalizeTrackPositions(playlist)
      if (!playlist.tracks.some((t) => t.id === track.id)) {
        const min = playlist.tracks.reduce(
          (lowest, t) => Math.min(lowest, t.playlistPosition ?? 0),
          0
        )
        const position = playlist.tracks.length > 0 ? min - 1 : 0
        playlist.tracks.unshift({ ...track, playlistPosition: position })
      }
      playlist.updatedAt = Date.now()
      updated = { ...playlist, tracks: [...playlist.tracks] }
    })
    return updated
  }

  /**
   * Add many tracks at once, preserving their order. Used by playlist import:
   * one store write instead of one per track, which matters for 1,000-track lists.
   */
  addTracks(playlistId: string, tracks: Track[]): Playlist | null {
    const valid = tracks.filter(isValidTrack)
    if (valid.length === 0) return null

    let updated: Playlist | null = null
    this.store.update((data) => {
      const playlist = (data.playlists ?? []).find((p) => p.id === playlistId)
      if (!playlist) return
      normalizeTrackPositions(playlist)

      const seen = new Set(playlist.tracks.map((track) => track.id))
      let next =
        playlist.tracks.reduce((max, track) => Math.max(max, track.playlistPosition ?? 0), -1) + 1
      for (const track of valid) {
        if (seen.has(track.id)) continue
        seen.add(track.id)
        playlist.tracks.push({ ...track, playlistPosition: next })
        next += 1
      }
      playlist.updatedAt = Date.now()
      updated = { ...playlist, tracks: [...playlist.tracks] }
    })
    return updated
  }

  removeFromPlaylist(playlistId: string, trackId: string): Playlist | null {
    let updated: Playlist | null = null
    this.store.update((data) => {
      const playlist = (data.playlists ?? []).find((p) => p.id === playlistId)
      if (!playlist) return
      playlist.tracks = playlist.tracks.filter((t) => t.id !== trackId)
      playlist.updatedAt = Date.now()
      updated = { ...playlist, tracks: [...playlist.tracks] }
    })
    return updated
  }

  // ---- account sync -------------------------------------------------------

  /**
   * Merge a page of pulled records in one write. Additions are upserted by id;
   * deletions are applied only to the exact record named, never to a whole
   * collection. Invalid payloads are ignored rather than allowed to break the
   * file.
   */
  applyRemote(ops: RemoteLibraryOps): void {
    this.store.update((data) => {
      if (!Array.isArray(data.favorites)) data.favorites = []
      if (!Array.isArray(data.history)) data.history = []
      if (!Array.isArray(data.playlists)) data.playlists = []
      if (!Array.isArray(data.albums)) data.albums = []

      const dropFavorites = new Set(ops.favorites?.remove ?? [])
      const favorites = data.favorites.filter(isValidTrack).filter((t) => !dropFavorites.has(t.id))
      for (const track of ops.favorites?.upsert ?? []) {
        if (!isValidTrack(track)) continue
        const at = favorites.findIndex((t) => t.id === track.id)
        if (at >= 0) favorites[at] = { ...track }
        else favorites.unshift({ ...track })
      }
      data.favorites = favorites

      const dropPlaylists = new Set(ops.playlists?.remove ?? [])
      const playlists = data.playlists.filter(isValidPlaylist).filter((p) => !dropPlaylists.has(p.id))
      for (const playlist of ops.playlists?.upsert ?? []) {
        if (!isValidPlaylist(playlist)) continue
        const at = playlists.findIndex((p) => p.id === playlist.id)
        if (at >= 0) {
          // Metadata only: tracks arrive as individual playlist items.
          playlists[at] = {
            ...playlists[at],
            name: playlist.name,
            createdAt: playlist.createdAt,
            updatedAt: playlist.updatedAt
          }
        } else {
          playlists.unshift({ ...playlist, tracks: [] })
        }
      }
      data.playlists = playlists

      const touchedPlaylists = new Set<string>()
      for (const entry of ops.playlistItems?.remove ?? []) {
        const playlist = playlists.find((p) => p.id === entry.playlistId)
        if (!playlist) continue
        playlist.tracks = playlist.tracks.filter((track) => track.id !== entry.trackId)
        touchedPlaylists.add(playlist.id)
      }
      for (const entry of ops.playlistItems?.upsert ?? []) {
        const playlist = playlists.find((p) => p.id === entry.playlistId)
        if (!playlist || !isValidTrack(entry.track)) continue
        normalizeTrackPositions(playlist)
        const position = Number.isFinite(entry.position) ? entry.position : 0
        const track: Track = { ...entry.track, playlistPosition: position }
        const at = playlist.tracks.findIndex((t) => t.id === track.id)
        if (at >= 0) playlist.tracks[at] = track
        else playlist.tracks.push(track)
        touchedPlaylists.add(playlist.id)
      }
      for (const id of touchedPlaylists) {
        const playlist = playlists.find((p) => p.id === id)
        if (!playlist) continue
        playlist.tracks.sort(
          (a, b) => (a.playlistPosition ?? 0) - (b.playlistPosition ?? 0) || a.id.localeCompare(b.id)
        )
      }

      const dropAlbums = new Set(ops.albums?.remove ?? [])
      const albums = data.albums.filter(isValidSavedAlbum).filter((a) => !dropAlbums.has(a.id))
      for (const album of ops.albums?.upsert ?? []) {
        if (!isValidSavedAlbum(album)) continue
        const at = albums.findIndex((a) => a.id === album.id)
        if (at >= 0) albums[at] = { ...album }
        else albums.unshift({ ...album })
      }
      data.albums = albums

      const dropHistory = new Set(
        (ops.history?.remove ?? []).map((row) => `${row.trackId}\u0000${row.playedAt}`)
      )
      let history = data.history
        .filter(isValidHistoryEntry)
        .filter((entry) => !dropHistory.has(`${entry.trackId}\u0000${entry.playedAt}`))
      for (const entry of ops.history?.upsert ?? []) {
        if (!isValidHistoryEntry(entry)) continue
        const at = history.findIndex(
          (row) => row.trackId === entry.trackId && row.playedAt === entry.playedAt
        )
        if (at >= 0) history[at] = { ...entry }
        else history.push({ ...entry })
      }
      history.sort((a, b) => b.playedAt - a.playedAt)
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY)
      data.history = history
    })
  }
}

let library: Library | null = null

export function lib(): Library {
  if (!library) library = new Library()
  return library
}
