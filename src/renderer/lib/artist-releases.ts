import type { CatalogItem, Shelf } from '@shared/types'

export type ArtistRelease = {
  item: CatalogItem
  kind: string
  year?: number
}

export type ArtistReleaseGroups = {
  /** A mixed first row across albums and singles, the artist-page default. */
  popular: ArtistRelease[]
  albums: ArtistRelease[]
  singles: ArtistRelease[]
  /** Everything, newest first. */
  all: ArtistRelease[]
}

const YEAR_RE = /\b(19\d{2}|20\d{2})\b/
const KIND_RE = /^(album|single|ep|compilation|soundtrack|audiobook)$/i
const KIND_LABEL: Record<string, string> = {
  album: 'Album',
  single: 'Single',
  ep: 'EP',
  compilation: 'Compilation',
  soundtrack: 'Soundtrack',
  audiobook: 'Audiobook'
}
const POPULAR_LIMIT = 6

function yearOf(item: CatalogItem): number | undefined {
  const match = YEAR_RE.exec(item.subtitle ?? '')
  return match ? Number(match[1]) : undefined
}

/**
 * YouTube sometimes omits the release label (some artist shelves only say the
 * year), so infer it from the subtitle and fall back to the shelf it came from.
 */
function kindOf(item: CatalogItem, fallback: string): string {
  if (item.releaseType) return item.releaseType
  for (const part of (item.subtitle ?? '').split('•')) {
    const label = part.trim()
    if (KIND_RE.test(label)) return KIND_LABEL[label.toLowerCase()]
  }
  return fallback
}

function decorate(item: CatalogItem, fallbackKind: string): ArtistRelease {
  const year = yearOf(item)
  const kind = kindOf(item, fallbackKind)
  return {
    kind,
    year,
    item: {
      ...item,
      releaseType: kind,
      // One consistent card caption: "Album • 2013", even when the shelf only
      // supplied the year, and never a mixed artist/year run.
      subtitle: [kind, year].filter(Boolean).join(' • '),
      parts: undefined
    }
  }
}

function releasesFrom(shelf: Shelf | undefined, fallbackKind: string): ArtistRelease[] {
  if (!shelf) return []
  const seen = new Set<string>()
  const releases: ArtistRelease[] = []
  for (const item of shelf.items) {
    if (item.kind !== 'album' || !item.browseId || seen.has(item.id)) continue
    seen.add(item.id)
    releases.push(decorate(item, fallbackKind))
  }
  return releases
}

/** Albums and Singles & EPs shelves, already complete on an artist browse. */
export function artistReleaseGroups(shelves: Shelf[]): ArtistReleaseGroups {
  const albumShelf = shelves.find((shelf) => /^albums$/i.test(shelf.title.trim()))
  const singleShelf = shelves.find((shelf) => /\bsingles?\b|\beps?\b/i.test(shelf.title))
  const albums = releasesFrom(albumShelf, 'Album')
  const singles = releasesFrom(singleShelf, 'Single')

  const popular: ArtistRelease[] = []
  const seen = new Set<string>()
  const max = Math.max(albums.length, singles.length)
  for (let i = 0; i < max && popular.length < POPULAR_LIMIT; i++) {
    for (const candidate of [albums[i], singles[i]]) {
      if (!candidate || seen.has(candidate.item.id)) continue
      seen.add(candidate.item.id)
      popular.push(candidate)
      if (popular.length >= POPULAR_LIMIT) break
    }
  }

  const all: ArtistRelease[] = []
  const allSeen = new Set<string>()
  for (const release of [...albums, ...singles]) {
    if (allSeen.has(release.item.id)) continue
    allSeen.add(release.item.id)
    all.push(release)
  }
  all.sort((a, b) => {
    const left = a.year ?? Number.NEGATIVE_INFINITY
    const right = b.year ?? Number.NEGATIVE_INFINITY
    return right - left
  })

  return { popular, albums, singles, all }
}
