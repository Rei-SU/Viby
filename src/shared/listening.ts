import type { CatalogItem, HistoryEntry, SubtitlePart } from './types'
import { artistNames, splitArtistParts } from './artist-credits'

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
    const name =
      artistNames(entry.artistParts ?? [])[0] ||
      entry.artist.split(',')[0]?.trim() ||
      'Unknown artist'
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

/**
 * A history entry as a row item: the artwork, title and duration come from the
 * play, the credits keep every artist link, and the release is a link even when
 * the entry predates release ids (it resolves by name on click).
 */
export function historyItem(entry: HistoryEntry): CatalogItem {
  const artist = entry.artist.trim() || 'Unknown artist'
  const credit = entry.artistParts?.length
    ? entry.artistParts
    : splitArtistParts(artist, entry.artistId)
  const parts: SubtitlePart[] = [...credit]
  const album = entry.album?.trim()
  if (album) {
    if (parts.length > 0) parts.push({ text: ' · ' })
    parts.push({ text: album, albumId: entry.albumId, entity: 'album' })
  }
  const names = artistNames(credit)

  return {
    id: entry.trackId,
    kind: 'song',
    title: entry.title,
    subtitle: album ? `${artist} · ${album}` : artist,
    album,
    albumId: entry.albumId,
    releaseType: entry.releaseType,
    artists: names.length ? names : artist === 'Unknown artist' ? undefined : [artist],
    thumbnail: entry.thumbnail,
    durationSec: entry.durationSec,
    parts: parts.length ? parts : undefined
  }
}
