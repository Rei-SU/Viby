import type { BrowseResult, CatalogItem, Track } from '@shared/types'
import { pickTrackIndex, releaseSearchTitle } from '@shared/track-match'
import { api } from './api'
import { cachedDetail, cacheDetail } from './catalog-cache.svelte'
import { albumCreditsArtist, pickAlbum, primaryArtistName } from './entity-lookup'
import { nav } from './nav.svelte'
import { network } from './network.svelte'
import { toTrack } from './player.svelte'

/**
 * What clicking a song title should do.
 *
 * An album or EP is the destination even when the song is also sold as a
 * single: the release page gives it context, and the clicked row is scrolled
 * into view and flashed. A single with no album behind it has no extra page,
 * so it opens the song page.
 *
 * Search results rarely know their release, and their video id may differ from
 * the row on the release. In that case the album is discovered by searching
 * releases by song title and artist, then confirmed by finding the same
 * recording in the page's track list.
 */

function isSingle(type?: string): boolean {
  return !!type && /^single$/i.test(type.trim())
}

let requestId = 0

/** Session cache: a track's album does not change while the app is open. */
const discoveryCache = new Map<string, { item: CatalogItem; songs: CatalogItem[] } | null>()

async function browse(id: string): Promise<BrowseResult | null> {
  const cached = cachedDetail(id)
  if (cached) return cached
  const res = await api.catalog.browse(id)
  if (!res.ok) return null
  cacheDetail(id, res.data)
  return res.data
}

function songRows(data: BrowseResult | null): CatalogItem[] {
  return (data?.items ?? []).filter((item) => item.kind === 'song' && item.id)
}

function releaseItem(data: BrowseResult, id: string, fallbackTitle?: string): CatalogItem {
  const type = data.header?.releaseType
  return {
    id,
    browseId: id,
    kind: 'album',
    title: data.header?.title ?? fallbackTitle ?? 'Album',
    subtitle: type ?? 'Album',
    releaseType: type,
    thumbnail: data.header?.thumbnail
  }
}

async function lookup(name: string, artist: string): Promise<CatalogItem | null> {
  const title = name.trim()
  if (!title) return null
  const query = [title, artist].filter(Boolean).join(' ')
  const res = await api.catalog.search(query, 'albums')
  if (!res.ok) return null
  return pickAlbum(res.data, title, artist)
}

/** The release page a track already points at, with its rows. */
async function taggedRelease(
  track: Track
): Promise<{ item: CatalogItem; songs: CatalogItem[] } | null> {
  if (track.albumId) {
    const data = await browse(track.albumId)
    const songs = songRows(data)
    if (!data || songs.length === 0) return null
    return { item: releaseItem(data, track.albumId, track.album?.trim()), songs }
  }

  const title = track.album?.trim()
  if (!title) return null
  const found = await lookup(title, primaryArtistName(track))
  if (!found?.browseId) return null
  const data = await browse(found.browseId)
  const songs = songRows(data)
  if (!data || songs.length === 0) return null
  return { item: found, songs }
}

/**
 * Find an album whose track list contains the same recording. Singles are
 * skipped — they are the thing we are trying to look past — and a candidate
 * only counts when the recording matches by id or title (with duration to
 * break duplicate-title ties).
 */
async function discoverAlbum(
  track: Track
): Promise<{ item: CatalogItem; songs: CatalogItem[] } | null> {
  if (discoveryCache.has(track.id)) return discoveryCache.get(track.id) ?? null

  const artist = primaryArtistName(track)
  if (!artist || !track.title.trim()) {
    discoveryCache.set(track.id, null)
    return null
  }

  const res = await api.catalog.search(`${releaseSearchTitle(track.title)} ${artist}`, 'albums')
  let found: { item: CatalogItem; songs: CatalogItem[] } | null = null

  if (res.ok) {
    const candidates = res.data
      .filter((item) => item.kind === 'album' && item.browseId)
      .filter((item) => !isSingle(item.releaseType))
      .filter((item) => albumCreditsArtist(item, artist))
      .slice(0, 3)

    for (const candidate of candidates) {
      const data = await browse(candidate.browseId!)
      const songs = songRows(data)
      if (!data || songs.length < 2) continue
      const index = pickTrackIndex(songs, {
        id: track.id,
        title: track.title,
        durationSec: track.durationSec
      })
      if (index < 0) continue
      found = { item: releaseItem(data, candidate.browseId!, candidate.title), songs }
      break
    }
  }

  discoveryCache.set(track.id, found)
  if (discoveryCache.size > 200) {
    const oldest = discoveryCache.keys().next().value
    if (oldest !== undefined) discoveryCache.delete(oldest)
  }
  return found
}

function openInRelease(
  release: { item: CatalogItem; songs: CatalogItem[] },
  track: Track
): void {
  // Hand the page the exact row id when we found it, so the flash lands on the
  // recording instead of relying on a title search again.
  const index = pickTrackIndex(release.songs, {
    id: track.id,
    title: track.title,
    durationSec: track.durationSec
  })
  const row = index >= 0 ? release.songs[index] : null
  nav.openReleaseAt(
    release.item,
    row?.id ?? track.id,
    row?.title ?? track.title,
    track.durationSec
  )
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

  const release = await taggedRelease(track)
  if (stale()) return

  if (release && !isSingle(release.item.releaseType) && release.songs.length > 1) {
    openInRelease(release, track)
    return
  }

  // A single, a one-track release, or no usable release at all: prefer the
  // album that actually contains this recording.
  const album = await discoverAlbum(track)
  if (stale()) return

  if (album) {
    openInRelease(album, track)
    return
  }

  nav.openTrack(track)
}

/** Row click-to-play stays put; only the title opens the release/song page. */
export function openTrackFromItem(item: CatalogItem): void {
  if (item.kind !== 'song' || !item.id) return
  void openTrackTarget(toTrack(item))
}
