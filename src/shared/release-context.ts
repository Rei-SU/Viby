import type { CatalogItem } from './types'

export type ReleaseContext = {
  album?: string
  albumId?: string
  releaseType?: string
  thumbnail?: string
}

/**
 * Release browse rows rarely carry their own cover or album links. Fill the
 * gaps from the release page without overwriting anything the row knows.
 */
export function withReleaseContext(item: CatalogItem, context: ReleaseContext): CatalogItem {
  return {
    ...item,
    album: item.album?.trim() || context.album?.trim() || undefined,
    albumId: item.albumId ?? context.albumId,
    releaseType: item.releaseType ?? context.releaseType,
    thumbnail: item.thumbnail ?? context.thumbnail
  }
}
