import type { SubtitlePart, Track } from './types'

/**
 * Artist credits arrive as subtitle runs: a linked name, a plain separator, the
 * next named link ("Stormy", ", ", "Manal"), and then whatever follows (album,
 * release line, counters). Only the leading run names artists.
 *
 * `CatalogItem.parts` already carries that structure, but a Track used to keep
 * just one `artistId`. These helpers are the single place that turns either
 * shape into per-artist parts the UI can link.
 */

/** Punctuation-only fragments between credits (" • ", ", ", " & "). */
export function isSeparator(part: SubtitlePart): boolean {
  return !part.artistId && !part.albumId && !part.entity && /^[\s,&•·|/+-]+$/.test(part.text)
}

/** A run that names an artist rather than a separator or a connector word. */
export function isArtistName(part: SubtitlePart): boolean {
  if (isSeparator(part)) return false
  return !/^(?:feat(?:uring)?|ft|with|vs|and|x)[.:]?$/i.test(part.text.trim())
}

/** A play/like counter or a duration — never part of the credit run. */
function isCounter(part: SubtitlePart): boolean {
  if (part.artistId || part.albumId || part.entity) return false
  return /^(?:\d[\d.,]*\s*[KMB]?\s*(?:views?|plays?|likes?)|\d{1,2}:\d{2}(?::\d{2})?)$/i.test(
    part.text.trim()
  )
}

/**
 * Search rows begin with their page-type label ("Song • Artist"), which is a
 * tag, not a credit. Leaving it in produced an artist named "Song" with no id,
 * so a click searched for a random artist called Song.
 */
const PAGE_TYPE_LABEL = /^(?:song|video|ep|album|single|playlist|podcast|profile|artist)$/i

/** Just the artist credit run from a row's subtitle parts, separators included. */
export function creditParts(parts: SubtitlePart[] | undefined): SubtitlePart[] | undefined {
  if (!parts?.length) return undefined

  let start = 0
  if (
    parts.length >= 3 &&
    PAGE_TYPE_LABEL.test(parts[0].text.trim()) &&
    !parts[0].artistId &&
    !parts[0].albumId &&
    !parts[0].entity &&
    isSeparator(parts[1])
  ) {
    start = 2
  }

  const credit: SubtitlePart[] = []
  for (const part of parts.slice(start)) {
    // Everything from the album on is not a credit.
    if (part.albumId || part.entity === 'album' || isCounter(part)) break
    // Copy: catalog rows can be Svelte state proxies, and structured clone
    // (IPC) rejects proxies even when they wrap plain data.
    credit.push({ ...part })
  }
  while (credit.length > 0 && isSeparator(credit[credit.length - 1])) credit.pop()
  while (credit.length > 0 && isSeparator(credit[0])) credit.shift()

  return credit.some(isArtistName) ? credit : undefined
}

/**
 * Conservative split of a combined credit string. Only used when the source
 * did not provide structured parts, so a name that itself contains a separator
 * ("Simon & Garfunkel") can still split; the parts carry no id, so a click
 * searches for that exact name instead of opening a guessed page.
 *
 * Deliberately not split: "R&B" (no spaces around the ampersand), "AC/DC",
 * bare hyphens, and a trailing "X" ("Malcolm X").
 */
const SPLIT_RE =
  /\s*,\s*|\s+[&+]\s+|\s+(?:feat(?:uring)?|ft|with)(?=\.?\s|\.?$)\.?\s*|\s+[x×]\s+/gi

export function splitArtistParts(name: string, artistId?: string): SubtitlePart[] {
  // Older store entries kept the row tag in the display string.
  const text = name
    .trim()
    .replace(/^(?:song|video|ep|album|single|playlist|podcast|profile|artist)\s+[•·]\s+/i, '')
  if (!text || /^unknown artist$/i.test(text)) return []

  const names: string[] = []
  const separators: string[] = []
  let last = 0
  for (const match of text.matchAll(SPLIT_RE)) {
    const start = match.index ?? 0
    names.push(text.slice(last, start).trim())
    separators.push(match[0])
    last = start + match[0].length
  }
  names.push(text.slice(last).trim())

  if (names.length < 2 || names.some((part) => !part)) {
    return [{ text, artistId, entity: 'artist' }]
  }

  const parts: SubtitlePart[] = []
  names.forEach((part, index) => {
    if (index > 0) parts.push({ text: separators[index - 1] })
    // The stored id is the primary credit, which YouTube lists first.
    parts.push({ text: part, artistId: index === 0 ? artistId : undefined, entity: 'artist' })
  })
  return parts
}

/** Structured credits when the source had them; a conservative split otherwise. */
export function artistPartsFor(
  track: Pick<Track, 'artist' | 'artistId' | 'artistParts'>
): SubtitlePart[] {
  // Stored parts from older builds can still contain a page-type label; clean
  // them on read so history and downloads do not keep a link named "Song".
  const stored = creditParts(track.artistParts)
  if (stored?.length) return stored
  return splitArtistParts(track.artist, track.artistId)
}

/** Names only, for callers that need a list rather than render parts. */
export function artistNames(parts: SubtitlePart[]): string[] {
  return parts
    .filter(isArtistName)
    .map((part) => part.text.trim())
    .filter(Boolean)
}
