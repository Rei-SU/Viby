import type { CatalogItem, Track } from '@shared/types'
import { api } from './api'
import { cachedDetail, cacheDetail } from './catalog-cache.svelte'
import { nav } from './nav.svelte'
import { network } from './network.svelte'
import { toTrack } from './player.svelte'
import { savedAlbums } from './saved-albums.svelte'

/**
 * What clicking a song title should do.
 *
 * A song that belongs to an album or EP opens that release at its row; a single
 * has no extra context to show, so it opens the song page instead. YouTube only
 * labels a release on its own card or page, so a row without a known type asks
 * the catalogue before choosing — the browse result is cached for the page that
 * opens next, which makes the wait cost nothing in practice.
 */
function isSingle(type?: string): boolean {
  return !!type && /^single$/i.test(type.trim())
}

let requestId = 0

async function browse(id: string) {
  const cached = cachedDetail(id)
  if (cached) return cached
  const res = await api.catalog.browse(id)
  if (!res.ok) return null
  cacheDetail(id, res.data)
  return res.data
}

async function lookup(name: string): Promise<CatalogItem | null> {
  const query = name.trim()
  if (!query) return null
  const res = await api.catalog.search(query, 'albums')
  if (!res.ok) return null
  return res.data.find((item) => item.kind === 'album' && item.browseId) ?? null
}

/** Resolve a track's release and navigate from the current view. */
export async function openTrackTarget(track: Track): Promise<void> {
  // Releases need the catalogue; offline the song page is the only real page.
  if (network.localFirst) {
    nav.openTrack(track)
    return
  }

  const request = ++requestId
  const startingRev = nav.revision
  const stale = (): boolean => request !== requestId || nav.revision !== startingRev

  let id = track.albumId
  let title = track.album?.trim()
  let type = track.releaseType
  let thumbnail = track.thumbnail
  /** A one-track release adds nothing beyond the song page, even unlabelled. */
  let solo = false

  // A release the user saved already knows its type, and one open in another
  // view is in the cache. Only a genuinely unknown release costs a request.
  if (!type && id) {
    type = savedAlbums.items.find((album) => album.id === id)?.releaseType
  }

  if (!type && id) {
    const data = await browse(id)
    if (stale()) return
    if (!data) {
      // The release page would fail too; the song page always works.
      nav.openTrack(track)
      return
    }
    type = data.header?.releaseType
    title = data.header?.title || title
    thumbnail = data.header?.thumbnail ?? thumbnail
    if (!type) solo = data.items.filter((item) => item.kind === 'song' && item.id).length === 1
  }

  if (solo || isSingle(type)) {
    nav.openTrack(track)
    return
  }

  if (!id && title) {
    const found = await lookup(title)
    if (stale()) return
    if (!found?.browseId) {
      nav.openTrack(track)
      return
    }
    if (!type && isSingle(found.releaseType)) {
      nav.openTrack(track)
      return
    }
    nav.openReleaseAt(found, track.id, track.title)
    return
  }

  if (!id) {
    nav.openTrack(track)
    return
  }

  nav.openReleaseAt(
    {
      id,
      browseId: id,
      kind: 'album',
      title: title || track.title,
      subtitle: type ?? 'Album',
      releaseType: type,
      thumbnail
    },
    track.id,
    track.title
  )
}

/** Row click-to-play stays put; only the title opens the release/song page. */
export function openTrackFromItem(item: CatalogItem): void {
  if (item.kind !== 'song' || !item.id) return
  void openTrackTarget(toTrack(item))
}
