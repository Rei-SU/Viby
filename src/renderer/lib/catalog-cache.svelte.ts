import type { BrowseResult, CatalogItem, Shelf } from '@shared/types'
import { api } from './api'

const TTL_MS = 10 * 60 * 1000

/**
 * Catalog pages are cheap to fetch but not free (and the network here is not
 * fast). Keeping them around makes going back to a shelf or an artist page feel
 * instant instead of showing a spinner again.
 */
export class ShelfState {
  shelves = $state<Shelf[]>([])
  loading = $state(false)
  error = $state<string | null>(null)
  /** Plain flag: prevents a failed load from retrying forever in an effect. */
  attempted = false
}

export const homeShelves = new ShelfState()

const detailCache = new Map<string, { data: BrowseResult; at: number }>()

export function cachedDetail(id: string): BrowseResult | null {
  const hit = detailCache.get(id)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    detailCache.delete(id)
    return null
  }
  return hit.data
}

export function cacheDetail(id: string, data: BrowseResult): void {
  detailCache.set(id, { data, at: Date.now() })

  if (detailCache.size > 40) {
    const oldest = [...detailCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) detailCache.delete(oldest[0])
  }
}

/** Cached browse, fetching once when missing. Shared by pages and the queue tail. */
export async function browseCached(id: string): Promise<BrowseResult | null> {
  const cached = cachedDetail(id)
  if (cached) return cached
  const res = await api.catalog.browse(id)
  if (!res.ok) return null
  cacheDetail(id, res.data)
  return res.data
}

/** Radio queues, keyed by seed track, so autoplay can be warmed ahead of time. */
const radioCache = new Map<string, CatalogItem[]>()

export function cachedRadio(seed: string): CatalogItem[] | null {
  return radioCache.get(seed) ?? null
}

export function cacheRadio(seed: string, items: CatalogItem[]): void {
  radioCache.set(seed, items)
  if (radioCache.size > 12) {
    const oldest = radioCache.keys().next().value
    if (oldest) radioCache.delete(oldest)
  }
}
