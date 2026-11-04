import type { CatalogItem } from '@shared/types'
import { withFallbackArtist, type ArtistIdentity } from '@shared/entity-identity'
import { withReleaseContext } from '@shared/release-context'
import { browseCached } from './catalog-cache.svelte'

/** First artist credit on a row, with its page id when YouTube gave one. */
export function itemArtist(item: CatalogItem): ArtistIdentity | null {
  const part = item.parts?.find((entry) => entry.artistId || entry.entity === 'artist')
  if (part?.text.trim()) return { name: part.text.trim(), id: part.artistId }
  const name = item.artists?.[0]?.trim()
  return name ? { name } : null
}

/**
 * Load the song rows for an album, EP, single or playlist card, filling the
 * cover, album links and missing credits from the release page. Shared by the
 * context menu's play, queue, playlist and download actions.
 */
export async function loadCollection(item: CatalogItem): Promise<CatalogItem[] | null> {
  const id = item.browseId ?? item.id
  if (!id) return null
  const data = await browseCached(id)
  if (!data) return null

  const artist = data.header?.artist ?? itemArtist(item)
  const album = item.kind === 'album' ? data.header?.title ?? item.title : undefined
  const albumId = item.kind === 'album' ? id : undefined
  const releaseType =
    item.kind === 'album' ? data.header?.releaseType ?? item.releaseType : undefined
  const thumbnail = data.header?.thumbnail ?? item.thumbnail

  return data.items
    .filter((row) => row.kind === 'song' && row.id)
    .map((row) =>
      withFallbackArtist(
        withReleaseContext(row, { album, albumId, releaseType, thumbnail }),
        artist
      )
    )
}
