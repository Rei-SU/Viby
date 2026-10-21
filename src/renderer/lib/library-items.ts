import type { DownloadCollection, DownloadEntry, Playlist, Track } from '@shared/types'
import type { CollectionRef } from './nav.svelte'
import { collectionEntries } from './download-groups'

export type DownloadMark = 'none' | 'partial' | 'full'

export type LibraryItem = {
  /** Stable key for {#each}. */
  id: string
  kind: 'liked' | 'playlist' | 'album'
  title: string
  subtitle: string
  /** Remote or already-local artwork; the view resolves it through the cache. */
  art?: string
  ref: CollectionRef
  mark: DownloadMark
  /** 0–100, used by the partial-download ring. */
  progress: number
  downloaded: number
  total: number
}

export function markFor(downloaded: number, total: number): DownloadMark {
  if (downloaded <= 0 || total <= 0) return 'none'
  return downloaded >= total ? 'full' : 'partial'
}

function firstArt(tracks: Track[]): string | undefined {
  return tracks.find((track) => Boolean(track.thumbnail))?.thumbnail
}

function countDownloaded(tracks: Track[], ids: Set<string>): number {
  return tracks.reduce((count, track) => count + (ids.has(track.id) ? 1 : 0), 0)
}

function collectionArt(
  collection: DownloadCollection,
  entries: DownloadEntry[]
): string | undefined {
  return (
    collection.artUrl ??
    collection.thumbnail ??
    collectionEntries(collection, entries)[0]?.artUrl ??
    collectionEntries(collection, entries)[0]?.track.thumbnail
  )
}

/**
 * Merge saved playlists and pinned download collections into one Spotify-style
 * Library. A downloaded playlist is not a second tile: the playlist's own tile
 * carries the badge, which keeps the grid free of duplicates.
 */
export function buildLibraryItems(
  favorites: Track[],
  playlists: Playlist[],
  collections: DownloadCollection[],
  entries: DownloadEntry[]
): LibraryItem[] {
  const ids = new Set(entries.map((entry) => entry.track.id))
  const items: LibraryItem[] = []

  const likedDownloaded = countDownloaded(favorites, ids)
  items.push({
    id: 'liked',
    kind: 'liked',
    title: 'Liked songs',
    subtitle: `${favorites.length} ${favorites.length === 1 ? 'song' : 'songs'}`,
    ref: { kind: 'liked' },
    mark: markFor(likedDownloaded, favorites.length),
    progress: favorites.length > 0 ? (likedDownloaded / favorites.length) * 100 : 0,
    downloaded: likedDownloaded,
    total: favorites.length
  })

  const playlistIds = new Set(playlists.map((playlist) => playlist.id))
  for (const playlist of playlists) {
    const downloaded = countDownloaded(playlist.tracks, ids)
    const mark = markFor(downloaded, playlist.tracks.length)
    const count = playlist.tracks.length
    items.push({
      id: `playlist:${playlist.id}`,
      kind: 'playlist',
      title: playlist.name,
      subtitle:
        mark === 'partial'
          ? `Playlist · ${downloaded} of ${count} downloaded`
          : `Playlist · ${count} ${count === 1 ? 'song' : 'songs'}`,
      art: firstArt(playlist.tracks),
      ref: { kind: 'playlist', id: playlist.id },
      mark,
      progress: count > 0 ? (downloaded / count) * 100 : 0,
      downloaded,
      total: count
    })
  }

  // Downloaded albums (and orphaned playlist snapshots) have no saved-library
  // record, so they become their own tiles. Liked and live playlists already
  // have one above.
  for (const collection of collections) {
    if (collection.key === 'liked') continue
    if (collection.key.startsWith('playlist:')) {
      const id = collection.key.slice('playlist:'.length)
      if (playlistIds.has(id)) continue
    }

    const owned = collectionEntries(collection, entries)
    const total = collection.trackIds.length
    const mark = markFor(owned.length, total)
    const kind = collection.kind === 'album' ? 'album' : 'playlist'
    const label = kind === 'album' ? 'Album' : 'Playlist'
    items.push({
      id: `collection:${collection.key}`,
      kind,
      title: collection.title,
      subtitle:
        mark === 'partial'
          ? `${label} · ${owned.length} of ${total} downloaded`
          : `${label} · ${total} ${total === 1 ? 'song' : 'songs'}`,
      art: collectionArt(collection, entries),
      ref: { kind: 'download', key: collection.key },
      mark,
      progress: total > 0 ? (owned.length / total) * 100 : 0,
      downloaded: owned.length,
      total
    })
  }

  return items
}
