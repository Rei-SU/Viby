import type { CatalogItem, HistoryEntry } from './types'

export type ListeningArtist = {
  key: string
  name: string
  artistId?: string
  thumbnail?: string
  plays: number
  tracks: number
  seconds: number
  lastPlayed: number
}

export type ListeningDay = {
  seconds: number
  plays: number
}

export type ListeningSummary = {
  since: number
  totalSeconds: number
  plays: number
  uniqueTracks: number
  days: ListeningDay[]
  artists: ListeningArtist[]
}

export type RecentGroup = {
  key: string
  title: string
  artist: string
  artistId?: string
  albumId?: string
  thumbnail?: string
  tracks: CatalogItem[]
}

export function summarizeHistory(history: HistoryEntry[], since: number): ListeningSummary {
  const DAY_MS = 24 * 60 * 60 * 1000
  const days: ListeningDay[] = Array.from({ length: 7 }, () => ({ seconds: 0, plays: 0 }))
  const artists = new Map<string, ListeningArtist>()
  const artistTracks = new Map<string, Set<string>>()
  const uniqueTracks = new Set<string>()
  let totalSeconds = 0
  let plays = 0

  for (const entry of history) {
    if (entry.playedAt < since || entry.playedAt >= since + DAY_MS * 7) continue
    const name = entry.artist.split(',')[0]?.trim() || 'Unknown artist'
    const key = `name:${name.toLowerCase()}`
    const duration = Number.isFinite(entry.durationSec) ? Math.max(0, entry.durationSec ?? 0) : 0
    const completion = Number.isFinite(entry.completion) ? Math.min(1, Math.max(0, entry.completion)) : 0
    const seconds = Math.round(duration * completion)
    const previous = artists.get(key)
    const artist = previous ?? {
      key,
      name,
      artistId: entry.artistId,
      thumbnail: entry.thumbnail,
      plays: 0,
      tracks: 0,
      seconds: 0,
      lastPlayed: 0
    }
    if (previous && !previous.artistId) previous.artistId = entry.artistId
    const tracks = artistTracks.get(key) ?? new Set<string>()
    tracks.add(entry.trackId)
    artistTracks.set(key, tracks)
    artist.tracks = tracks.size
    artist.plays += 1
    artist.seconds += seconds
    artist.lastPlayed = Math.max(artist.lastPlayed, entry.playedAt)
    artists.set(key, artist)
    totalSeconds += seconds
    const day = Math.min(6, Math.max(0, Math.floor((entry.playedAt - since) / DAY_MS)))
    days[day].seconds += seconds
    days[day].plays += 1
    uniqueTracks.add(entry.trackId)
    plays += 1
  }

  return {
    since,
    totalSeconds,
    plays,
    uniqueTracks: uniqueTracks.size,
    days,
    artists: [...artists.values()].sort(
      (a, b) => b.seconds - a.seconds || b.plays - a.plays || b.lastPlayed - a.lastPlayed
    )
  }
}

export function groupRecentHistory(
  history: HistoryEntry[],
  groupLimit = 2,
  tracksPerGroup = 3
): RecentGroup[] {
  const groups: RecentGroup[] = []
  const byKey = new Map<string, RecentGroup>()
  const seenTracks = new Set<string>()

  for (const entry of history) {
    if (seenTracks.has(entry.trackId)) continue
    seenTracks.add(entry.trackId)

    const artist = entry.artist.trim() || 'Unknown artist'
    const album = entry.album?.trim()
    const key = entry.albumId
      ? `album:${entry.albumId}`
      : album
        ? `album:${album.toLowerCase()}`
        : entry.artistId
          ? `artist:${entry.artistId}`
          : `artist:${artist.toLowerCase()}`
    const item: CatalogItem = {
      id: entry.trackId,
      kind: 'song',
      title: entry.title,
      subtitle: artist,
      thumbnail: entry.thumbnail,
      durationSec: entry.durationSec,
      artists: artist === 'Unknown artist' ? undefined : [artist],
      parts: entry.artistId
        ? [{ text: artist, artistId: entry.artistId, entity: 'artist' }]
        : undefined
    }

    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        title: album || artist,
        artist,
        artistId: entry.artistId,
        albumId: entry.albumId,
        thumbnail: entry.thumbnail,
        tracks: []
      }
      byKey.set(key, group)
      groups.push(group)
    }
    if (group.tracks.length < tracksPerGroup) group.tracks.push(item)
  }

  return groups.slice(0, Math.max(0, groupLimit))
}
