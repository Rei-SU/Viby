import type { BrowseResult, CatalogItem, PlaybackTail } from '@shared/types'
import { trackTitleKey } from '@shared/track-title'
import { withFallbackArtist, type ArtistIdentity } from '@shared/entity-identity'
import type { ArtistRelease } from './artist-releases'

export type ArtistQueueSource = {
  /** Next batch of release tracks, or null when the discography is exhausted. */
  next: () => Promise<CatalogItem[] | null>
  hasMore: () => boolean
  cancel: () => void
  /** Compact state for resuming this tail after a restart. */
  persist: () => PlaybackTail | null
}

/** One album is enough; a run of one-track singles still fills a usable batch. */
const MIN_BATCH = 5
const MAX_CONSECUTIVE_FAILURES = 3
/**
 * The same recording on a single and an album can differ by a second or two.
 * Beyond this, two same-titled rows are different recordings (two "Intro"s).
 */
const TITLE_DURATION_TOLERANCE = 3

/**
 * A lazy queue tail for the artist page's Play all: the popular songs start
 * immediately, then each release is browsed in the background as playback
 * approaches the end. Newest first, matching the Show all page.
 *
 * Releases and songs are deduped by id and by recording title, so a single that
 * also appears on an album is not queued twice and the popular rows are not
 * repeated by the albums that contain them.
 */
export function createArtistQueue(opts: {
  artist: ArtistIdentity
  releases: ArtistRelease[]
  popular: CatalogItem[]
  loadRelease: (browseId: string) => Promise<BrowseResult | null>
  isOffline: () => boolean
}): ArtistQueueSource {
  const seenIds = new Set<string>()
  const seenTitles = new Map<string, number[]>()
  const remember = (item: CatalogItem): void => {
    if (item.id) seenIds.add(item.id)
    const key = trackTitleKey(item.title)
    const durations = seenTitles.get(key)
    if (durations) durations.push(item.durationSec ?? 0)
    else seenTitles.set(key, [item.durationSec ?? 0])
  }
  /** Same id, or same title with a matching duration. */
  const isDuplicate = (item: CatalogItem): boolean => {
    if (item.id && seenIds.has(item.id)) return true
    const durations = seenTitles.get(trackTitleKey(item.title))
    if (!durations) return false
    const duration = item.durationSec ?? 0
    return durations.some(
      (prior) =>
        prior <= 0 || duration <= 0 || Math.abs(prior - duration) <= TITLE_DURATION_TOLERANCE
    )
  }
  for (const item of opts.popular) remember(item)

  const pending: string[] = []
  const queued = new Set<string>()
  const releases = new Map<string, ArtistRelease>()
  for (const release of opts.releases) {
    const id = release.item.browseId ?? release.item.id
    if (!id || queued.has(id)) continue
    queued.add(id)
    releases.set(id, release)
    pending.push(id)
  }

  let cancelled = false
  let inFlight: Promise<CatalogItem[] | null> | null = null
  let loadingId: string | null = null

  async function loadBatch(): Promise<CatalogItem[] | null> {
    const batch: CatalogItem[] = []
    let failures = 0

    while (batch.length < MIN_BATCH && pending.length > 0) {
      if (cancelled || opts.isOffline()) return batch.length > 0 ? batch : null

      const id = pending.shift()!
      let loaded: BrowseResult | null
      loadingId = id
      try {
        loaded = await opts.loadRelease(id)
      } catch {
        loaded = null
      } finally {
        loadingId = null
      }
      if (cancelled) return batch.length > 0 ? batch : null
      if (!loaded) {
        // A transient failure should not drop the rest of the discography; a
        // run of them means the network is gone, so stop rather than hammer it.
        if (++failures >= MAX_CONSECUTIVE_FAILURES) {
          pending.length = 0
          break
        }
        continue
      }
      failures = 0

      const release = releases.get(id)
      const header = loaded.header
      for (const row of loaded.items) {
        if (row.kind !== 'song' || !row.id) continue
        // Album rows rarely carry their own cover or release links. Without
        // these fallbacks the queue shows placeholders and history loses the
        // album context for every track beyond the popular list.
        const item: CatalogItem = {
          ...withFallbackArtist(row, opts.artist),
          album: row.album?.trim() || header?.title?.trim() || release?.item.title?.trim(),
          albumId: row.albumId ?? release?.item.browseId ?? release?.item.id,
          releaseType:
            row.releaseType ?? header?.releaseType ?? release?.item.releaseType,
          thumbnail:
            row.thumbnail ?? header?.thumbnail ?? release?.item.thumbnail
        }
        if (isDuplicate(item)) continue
        remember(item)
        batch.push(item)
      }
    }

    return batch.length > 0 ? batch : null
  }

  return {
    next: () => {
      if (cancelled) return Promise.resolve(null)
      if (inFlight) return inFlight
      const job = loadBatch()
      inFlight = job
      void job.finally(() => {
        if (inFlight === job) inFlight = null
      })
      return job
    },
    hasMore: () => !cancelled && (pending.length > 0 || inFlight !== null),
    cancel: () => {
      cancelled = true
      pending.length = 0
    },
    persist: () => {
      if (cancelled) return null
      // A release whose browse is still in flight has already left `pending`;
      // keep it in the descriptor so a quit at that moment does not skip it.
      const releaseIds = loadingId ? [loadingId, ...pending] : [...pending]
      if (releaseIds.length === 0) return null
      return { kind: 'artist', artist: { ...opts.artist }, releaseIds }
    }
  }
}
