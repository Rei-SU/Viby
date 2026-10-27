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
    // Without a release id the name alone is not unique: dozens of releases are
    // called "Sociopath". Keep the artist in the key so two same-named releases
    // by different artists never merge into one card.
    const key = entry.albumId
      ? `album:${entry.albumId}`
      : album
        ? `album:${album.toLowerCase()}|${entry.artistId ?? artist.toLowerCase()}`
        : entry.artistId
          ? `artist:${entry.artistId}`
          : `artist:${artist.toLowerCase()}`
    // Replaying a row from Recently played goes through `toTrack`, which reads
    // the release from these parts. Dropping the album here made every replay
    // lose its release and fall back to artist grouping.
    const credit = entry.artistParts?.length
      ? entry.artistParts
      : splitArtistParts(artist, entry.artistId)
    const parts: SubtitlePart[] = [...credit]
    if (album) {
      if (parts.length > 0) parts.push({ text: ' · ' })
      parts.push({ text: album, albumId: entry.albumId, entity: 'album' })
    }
    const names = artistNames(credit)
    const item: CatalogItem = {
      id: entry.trackId,
      kind: 'song',
      title: entry.title,
      subtitle: artist,
      thumbnail: entry.thumbnail,
      durationSec: entry.durationSec,
      artists: names.length ? names : artist === 'Unknown artist' ? undefined : [artist],
      parts: parts.length ? parts : undefined
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

/** Lowercase, strip accents and collapse punctuation so titles compare cleanly. */
function normalized(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function tokens(value: string): string[] {
  return normalized(value).split(' ').filter(Boolean)
}

/** A release's credits, preferring the structured list YouTube provides. */
function creditsOf(item: CatalogItem): string[] {
  if (item.artists?.length) return item.artists
  return (item.parts ?? [])
    .filter((part) => part.artistId || part.entity === 'artist')
    .map((part) => part.text.trim())
    .filter(Boolean)
}

/**
 * A credit has to name the same artist, token for token. A one-word name must
 * match a credit exactly, so "Pause" never matches "Pause flow"; a multi-word
 * primary artist may appear inside a collaboration, so "Yung Vision" still
 * matches "Yung Vision & Young Lime".
 */
function sameArtist(wanted: string, credit: string): boolean {
  const a = tokens(wanted)
  const b = tokens(credit)
  if (a.length === 0 || b.length === 0) return false
  if (a.join(' ') === b.join(' ')) return true
  return a.length > 1 && a.every((token) => b.includes(token))
}

/**
 * The release whose title and credits both match. There is deliberately no
 * title-only tier: twenty releases can share a name, and opening a stranger's
 * album is worse than falling back to the artist page.
 */
export function albumMatch(items: CatalogItem[], group: RecentGroup): CatalogItem | null {
  const title = normalized(group.title)
  const wanted = group.artist.split(',')[0]?.trim() || group.artist
  const releases = items.filter((item) => item.kind === 'album' && (item.browseId || item.id))
  const credited = (item: CatalogItem): boolean =>
    creditsOf(item).some((name) => sameArtist(wanted, name))
  return (
    releases.find((item) => normalized(item.title) === title && credited(item)) ??
    releases.find((item) => normalized(item.title).startsWith(title) && credited(item)) ??
    null
  )
}

export function artistMatch(items: CatalogItem[], group: RecentGroup): CatalogItem | null {
  const wanted = normalized(group.artist)
  const artists = items.filter((item) => item.kind === 'artist' && (item.browseId || item.id))
  return (
    (group.artistId
      ? artists.find((item) => item.browseId === group.artistId || item.id === group.artistId)
      : undefined) ??
    artists.find((item) => normalized(item.title) === wanted) ??
    null
  )
}
