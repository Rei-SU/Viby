import type { CatalogItem, DownloadCollection, DownloadEntry } from '@shared/types'
import { trackToItem } from './track'

/**
 * Downloads are a library of two things: collections and loose songs. These
 * helpers keep that split (and the offline artwork fallbacks) identical
 * everywhere it is rendered, without any catalog or network access.
 */

/** Local artwork for an entry: its own file, else the cover of a collection it belongs to. */
export function entryArt(
  entry: DownloadEntry,
  collections: DownloadCollection[]
): string | undefined {
  if (entry.artUrl) return entry.artUrl
  const owner = collections.find((collection) => entry.sources.includes(collection.key))
  return owner?.artUrl ?? owner?.thumbnail ?? entry.track.thumbnail
}

export function entryToItem(entry: DownloadEntry, collections: DownloadCollection[]): CatalogItem {
  return { ...trackToItem(entry.track), thumbnail: entryArt(entry, collections) }
}

/** Downloaded entries of one collection, keeping the album/playlist order. */
export function collectionEntries(
  collection: DownloadCollection,
  entries: DownloadEntry[]
): DownloadEntry[] {
  const byId = new Map(entries.map((entry) => [entry.track.id, entry]))
  return collection.trackIds
    .map((id) => byId.get(id))
    .filter((entry): entry is DownloadEntry => Boolean(entry))
}

export function collectionItems(
  collection: DownloadCollection,
  entries: DownloadEntry[]
): CatalogItem[] {
  return collectionEntries(collection, entries).map((entry) => ({
    ...trackToItem(entry.track),
    // Album rows frequently have no thumbnail; the collection cover is the
    // correct artwork for them and it is already on disk.
    thumbnail: entry.artUrl ?? collection.artUrl ?? collection.thumbnail ?? entry.track.thumbnail
  }))
}

/** Track ids that live inside a downloaded collection, not in the Songs list. */
export function collectionOwnedIds(
  collections: DownloadCollection[],
  entries: DownloadEntry[]
): Set<string> {
  const keys = new Set(collections.map((collection) => collection.key))
  const ids = new Set<string>()
  for (const entry of entries) {
    if (entry.sources.some((source) => keys.has(source))) ids.add(entry.track.id)
  }
  return ids
}

/** Downloads that are not owned by any downloaded collection. */
export function standaloneEntries(
  collections: DownloadCollection[],
  entries: DownloadEntry[]
): DownloadEntry[] {
  const owned = collectionOwnedIds(collections, entries)
  return entries.filter((entry) => !owned.has(entry.track.id))
}

export function collectionBytes(
  collection: DownloadCollection,
  entries: DownloadEntry[]
): number {
  return collectionEntries(collection, entries).reduce((sum, entry) => sum + entry.bytes, 0)
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (!bytes) return '0 MB'
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
