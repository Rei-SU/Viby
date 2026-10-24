import type { CatalogItem, ImportMatch, ImportSource, ImportTrack, Track } from '@shared/types'
import { search } from '../innertube/client'

export type MatchSearch = (query: string) => Promise<CatalogItem[]>
export type MatchProgress = (done: number, total: number) => void

const VERSION_WORDS = [
  'live',
  'remix',
  'acoustic',
  'instrumental',
  'karaoke',
  'demo',
  'sped up',
  'slowed',
  'reverb',
  'extended',
  'radio edit'
]

/** Lowercase, strip diacritics and edition noise, keep version words. */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\((?:feat|ft|featuring)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring)\b.*$/i, ' ')
    .replace(/\b(?:remaster(?:ed)?|deluxe|edition|explicit|bonus track)\b/gi, ' ')
    .replace(/\b(?:official|lyric)\s+(?:video|audio)\b/gi, ' ')
    .replace(/\bvisuali[sz]er\b/gi, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanArtist(value: string): string {
  return normalize(value).replace(/^the /, '')
}

function versions(value: string): string[] {
  const lower = value.toLowerCase()
  return VERSION_WORDS.filter((word) => lower.includes(word))
}

function tokens(value: string): Set<string> {
  return new Set(value.split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2))
  return set
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection++
  return (2 * intersection) / (a.size + b.size)
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const tokenScore = jaccard(tokens(a), tokens(b))
  const charScore = dice(bigrams(a), bigrams(b))
  return charScore > 0 ? 0.45 * tokenScore + 0.55 * charScore : tokenScore * 0.7
}

function candidateArtists(item: CatalogItem): string[] {
  if (item.artists?.length) return item.artists
  const linked = (item.parts ?? []).filter((part) => part.artistId).map((part) => part.text)
  if (linked.length) return linked
  return item.subtitle ? [item.subtitle.split(' • ')[0] ?? item.subtitle] : []
}

function artistSimilarity(source: ImportTrack, item: CatalogItem): number {
  const sourceArtists = source.artists.map(cleanArtist).filter(Boolean)
  const targetArtists = candidateArtists(item).map(cleanArtist).filter(Boolean)
  if (sourceArtists.length === 0 || targetArtists.length === 0) return 0.5

  let best = 0
  for (const artist of sourceArtists.slice(0, 2)) {
    for (const target of targetArtists) {
      if (artist === target) best = Math.max(best, 1)
      else if (artist.includes(target) || target.includes(artist)) best = Math.max(best, 0.8)
      else if (similarity(artist, target) >= 0.6) best = Math.max(best, 0.5)
    }
  }
  return best
}

function durationSimilarity(source?: number, target?: number): number {
  if (!source || !target) return 0.6
  const delta = Math.abs(source - target)
  if (delta <= 2) return 1
  if (delta <= 5) return 0.8
  if (delta <= 10) return 0.5
  if (delta <= 20) return 0.2
  return 0
}

type Scored = {
  item: CatalogItem
  score: number
  titleSim: number
  artistSim: number
  durationSim: number
  versionsDiffer: boolean
  automatic: boolean
  status: ImportMatch['status']
}

function scoreCandidate(source: ImportTrack, item: CatalogItem): Scored {
  const titleSim = similarity(normalize(source.title), normalize(item.title))
  const artistSim = artistSimilarity(source, item)
  const durationSim = durationSimilarity(source.durationSec, item.durationSec)

  const sourceVersions = versions(source.title)
  const candidateVersions = versions(item.title)
  const versionsDiffer =
    sourceVersions.length !== candidateVersions.length ||
    sourceVersions.some((word) => !candidateVersions.includes(word))

  const base = 0.5 * titleSim + 0.3 * artistSim + 0.2 * durationSim - (versionsDiffer ? 0.2 : 0)
  const bonus = item.videoType === 'audio' ? 0.04 : item.videoType === 'ugc' ? -0.1 : 0
  const score = Math.max(0, Math.min(1, base + bonus))

  const delta =
    source.durationSec && item.durationSec
      ? Math.abs(source.durationSec - item.durationSec)
      : null

  const automatic =
    score >= 0.9 &&
    titleSim >= 0.92 &&
    artistSim >= 0.7 &&
    !versionsDiffer &&
    (delta === null || delta <= 4)

  return {
    item,
    score,
    titleSim,
    artistSim,
    durationSim,
    versionsDiffer,
    automatic,
    status: automatic ? 'auto' : score >= 0.55 ? 'review' : 'missing'
  }
}

function toTrack(item: CatalogItem): Track {
  const parts = item.parts ?? []
  const artist =
    item.artists?.join(', ') ||
    parts.filter((part) => part.artistId).map((part) => part.text).join(', ') ||
    item.subtitle ||
    'Unknown artist'

  return {
    id: item.id,
    title: item.title,
    artist,
    artistId: parts.find((part) => part.artistId)?.artistId,
    album: parts.find((part) => part.albumId)?.text,
    albumId: parts.find((part) => part.albumId)?.albumId,
    durationSec: item.durationSec ?? 0,
    thumbnail: item.thumbnail,
    videoType: item.videoType,
    sourceUrl: `https://music.youtube.com/watch?v=${item.id}`
  }
}

/** A YouTube playlist already gives us the exact ids; no search needed. */
function sourceTrack(source: ImportTrack): Track {
  return {
    id: source.sourceId ?? '',
    title: source.title,
    artist: source.artists.join(', ') || 'Unknown artist',
    artistId: source.artistId,
    album: source.album,
    albumId: source.albumId,
    durationSec: source.durationSec ?? 0,
    thumbnail: source.thumbnail,
    videoType: source.videoType,
    sourceUrl: source.sourceUrl
  }
}

function primaryArtist(artists: string[]): string {
  return (artists[0] ?? '').split(/\s*(?:&|,|feat\.?|ft\.?|with)\s*/i)[0]?.trim() ?? ''
}

function queryFor(track: ImportTrack): string {
  const title = normalize(track.title) || track.title
  const artist = normalize(primaryArtist(track.artists))
  return `${title} ${artist}`.trim().slice(0, 120)
}

/**
 * Search YouTube Music for every source track and score the candidates.
 * Three searches run at a time; progress is reported per completed track.
 * Cancellation returns whatever finished (the UI discards it).
 */
export async function matchImport(
  source: ImportSource,
  onProgress: MatchProgress = () => undefined,
  isCancelled: () => boolean = () => false,
  searchFn: MatchSearch = (query) => search(query, 'songs')
): Promise<ImportMatch[]> {
  const total = source.tracks.length
  if (total === 0) return []

  const results: Array<ImportMatch | undefined> = new Array(total)
  const cache = new Map<string, CatalogItem[]>()
  let cursor = 0
  let done = 0
  const report = (): void => {
    if (done === total || done % 5 === 0) onProgress(done, total)
  }

  const searchCached = async (query: string): Promise<CatalogItem[]> => {
    const key = query.toLowerCase()
    const hit = cache.get(key)
    if (hit) return hit
    const items = await searchFn(query)
    cache.set(key, items)
    return items
  }

  const worker = async (): Promise<void> => {
    while (true) {
      if (isCancelled()) return
      const index = cursor++
      if (index >= total) return

      const track = source.tracks[index]
      if (source.service === 'youtube' && track.sourceId) {
        const candidate = sourceTrack(track)
        results[index] = {
          source: track,
          status: 'auto',
          score: 1,
          candidate,
          candidates: [candidate],
          reason: 'Exact YouTube Music track'
        }
        done++
        report()
        continue
      }

      const query = queryFor(track)
      if (!query) {
        results[index] = {
          source: track,
          status: 'missing',
          score: 0,
          candidates: [],
          reason: 'This track has no usable title'
        }
        done++
        report()
        continue
      }

      let items: CatalogItem[]
      try {
        items = await searchCached(query)
      } catch {
        if (isCancelled()) return
        results[index] = {
          source: track,
          status: 'missing',
          score: 0,
          candidates: [],
          reason: 'YouTube Music search failed for this track'
        }
        done++
        report()
        continue
      }
      if (isCancelled()) return

      const scored = items
        .map((item) => scoreCandidate(track, item))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      const best = scored[0]
      if (!best || best.status === 'missing') {
        results[index] = {
          source: track,
          status: 'missing',
          score: best?.score ?? 0,
          candidates: [],
          reason: 'No close match on YouTube Music'
        }
      } else {
        const candidates = scored.map((entry) => toTrack(entry.item))
        results[index] = {
          source: track,
          status: best.status,
          score: Number(best.score.toFixed(3)),
          candidate: candidates[0],
          candidates,
          reason: best.automatic
            ? 'Exact title, artist and duration'
            : best.versionsDiffer
              ? 'A different version (live/remix) may match better'
              : 'Close match — check the version and duration'
        }
      }

      done++
      report()
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(3, Math.max(1, total)) }, () => worker())
  )

  if (isCancelled()) return []
  return results.filter((match): match is ImportMatch => Boolean(match))
}
