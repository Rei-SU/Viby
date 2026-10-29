import { artistPartsFor, isArtistName } from '@shared/artist-credits'
import type { CatalogItem, Track } from '@shared/types'

/**
 * Identity matching for name-only entity links.
 *
 * A track rebuilt from history or a resolver can know a release's or artist's
 * name but not its page id. Searching for the name alone and opening the first
 * result sent clicks to unrelated pages ("Caméléon" exists under several
 * artists). These helpers only accept a result whose name — and, for releases,
 * whose credited artist — actually agree with what was clicked. Callers fall
 * back to search results when nothing is confident.
 */
export function normalizeEntityName(value: string): string {
  return value
    .normalize('NFKD')
    // Split accents from their letters before punctuation stripping, otherwise
    // "Caméléon" becomes "came le on".
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\b(?:feat|ft|with)\b.*$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Artists credited on an album search result, linked parts first. */
function albumArtistNames(item: CatalogItem): string[] {
  const linked = (item.parts ?? [])
    .filter((part) => part.artistId || part.entity === 'artist')
    .map((part) => part.text.trim())
    .filter(Boolean)
  if (linked.length > 0) return linked

  // Some cards only carry "Album • Artist • 2013" as plain subtitle text.
  return (item.subtitle ?? '')
    .split('•')
    .map((part) => part.trim())
    .filter(
      (part) =>
        Boolean(part) &&
        !/^\d{4}$/.test(part) &&
        !/^(?:album|single|ep|compilation|soundtrack)$/i.test(part)
    )
}

/** Exact artist-name match; a fuzzy name is never trusted with an identity. */
export function pickArtist(list: CatalogItem[], name: string): CatalogItem | null {
  const wanted = normalizeEntityName(name)
  if (!wanted) return null
  return (
    list.find(
      (item) =>
        item.kind === 'artist' && Boolean(item.browseId) && normalizeEntityName(item.title) === wanted
    ) ?? null
  )
}

/** True when a release search result is credited to that artist. */
export function albumCreditsArtist(item: CatalogItem, artist: string): boolean {
  const wanted = normalizeEntityName(artist)
  if (!wanted) return false
  return albumArtistNames(item).some((name) => {
    const normalized = normalizeEntityName(name)
    return normalized === wanted || normalized.includes(wanted) || wanted.includes(normalized)
  })
}

/**
 * Album/EP match by release title *and* artist. Without an artist there is no
 * safe answer: identical titles are common across artists.
 */
export function pickAlbum(
  list: CatalogItem[],
  title: string,
  artist: string | undefined
): CatalogItem | null {
  const wantedTitle = normalizeEntityName(title)
  if (!wantedTitle || !artist) return null

  return (
    list.find(
      (item) =>
        item.kind === 'album' &&
        Boolean(item.browseId) &&
        normalizeEntityName(item.title) === wantedTitle &&
        albumCreditsArtist(item, artist)
    ) ?? null
  )
}

/** The first credited artist of a track, as written, for release verification. */
export function primaryArtistName(track: Pick<Track, 'artist' | 'artistId' | 'artistParts'>): string {
  const first = artistPartsFor(track).find(isArtistName)
  if (first) return first.text.trim()
  return track.artist.split(',')[0]?.trim() ?? ''
}
