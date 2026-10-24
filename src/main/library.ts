import { randomUUID } from 'node:crypto'
import { JsonStore, userDataFile } from './json-store'
import type { HistoryEntry, Playlist, Track } from '@shared/types'

type LibraryData = {
  favorites: Track[]
  history: HistoryEntry[]
  playlists: Playlist[]
}

const MAX_HISTORY = 5000

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
      playlists: []
    })
    const data = this.store.get()
    if (
      !Array.isArray(data.favorites) ||
      !Array.isArray(data.history) ||
      !Array.isArray(data.playlists)
    ) {
      this.store.update((next) => {
        if (!Array.isArray(next.favorites)) next.favorites = []
        if (!Array.isArray(next.history)) next.history = []
        if (!Array.isArray(next.playlists)) next.playlists = []
      })
    }
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

  // ---- playlists ---------------------------------------------------------

  playlists(): Playlist[] {
    const value = this.store.get().playlists
    const stored = Array.isArray(value) ? value : []
    const clean = stored
      .filter(isValidPlaylist)
      .map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter(isValidTrack) }))

    const changed =
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
      if (!playlist.tracks.some((t) => t.id === track.id)) {
        playlist.tracks.unshift({ ...track })
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

      const seen = new Set(playlist.tracks.map((track) => track.id))
      for (const track of valid) {
        if (seen.has(track.id)) continue
        seen.add(track.id)
        playlist.tracks.push({ ...track })
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
}

let library: Library | null = null

export function lib(): Library {
  if (!library) library = new Library()
  return library
}
