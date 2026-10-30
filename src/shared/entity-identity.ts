import { artistNames, splitArtistParts } from './artist-credits'
import type { CatalogItem } from './types'

/**
 * Identity rules shared by name-only entity links and the audio-first swap.
 * A recording is identified by its name *and* its artist; matching one alone
 * is how a same-titled song by someone else gets played or opened.
 */
export function normalizeEntityName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\b(?:feat|ft|with)\b.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** First credited artist of a combined string, e.g. "A, B" or "Song • A". */
export function primaryArtistName(name: string): string {
  return artistNames(splitArtistParts(name))[0] ?? ''
}

/** Exact, accent-insensitive artist match — never a fuzzy one. */
export function artistMatches(credited: string, primary: string): boolean {
  const left = normalizeEntityName(credited)
  const right = normalizeEntityName(primary)
  return Boolean(left) && Boolean(right) && left === right
}

export type ArtistIdentity = { name: string; id?: string }

/**
 * Release track lists often omit the artist entirely. When the page already
 * knows whose release this is, fill that identity instead of showing "Unknown
 * artist" and playing a track without credits.
 */
export function withFallbackArtist(
  item: CatalogItem,
  artist?: ArtistIdentity | null
): CatalogItem {
  if (!artist?.name) return item
  const hasArtist =
    (item.artists?.length ?? 0) > 0 ||
    (item.parts ?? []).some((part) => part.artistId || part.entity === 'artist')
  if (hasArtist) return item

  return {
    ...item,
    subtitle: artist.name,
    artists: [artist.name],
    parts: [{ text: artist.name, artistId: artist.id, entity: 'artist' }]
  }
}

const VERSION_WORD =
  /\b(live|remix|cover|karaoke|instrumental|acoustic|sped up|slowed|nightcore)\b/i

/**
 * Choose the audio release for a video row. The artist must agree: without it
 * a bare title resolves to whoever's same-named song is most popular, which is
 * precisely the wrong song.
 */
export function pickAudioTrack(
  results: CatalogItem[],
  title: string,
  artist: string
): CatalogItem | null {
  const base = normalizeEntityName(title)
  const primary = normalizeEntityName(primaryArtistName(artist))
  if (!base || !primary) return null

  const baseHasVersion = VERSION_WORD.test(base)
  const ranked = results
    .filter((item) => item.kind === 'song' && item.id && item.videoType !== 'ugc')
    .map((item) => {
      const name = normalizeEntityName(item.title)
      if (!name || !(name === base || name.startsWith(base) || base.startsWith(name))) {
        return null
      }
      let score = name === base ? 4 : 2
      const credited = (item.artists ?? []).some((artistName) => artistMatches(artistName, primary))
      if (credited) score += 3
      else if (primary) score -= 6
      if (!baseHasVersion && VERSION_WORD.test(name)) score -= 4
      if (item.videoType === 'audio') score += 1
      return { item, score, credited }
    })
    .filter((entry): entry is { item: CatalogItem; score: number; credited: boolean } =>
      Boolean(entry)
    )
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  if (!top) return null
  // The row named an artist, so a result by anyone else is not this recording.
  if (primary && !top.credited) return null
  return top.item
}
