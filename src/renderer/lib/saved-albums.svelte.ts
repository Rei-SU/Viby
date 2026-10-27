import type { SavedAlbum } from '@shared/types'
import { api } from './api'

/**
 * Releases saved to the library, mirrored in the renderer so the release page's
 * Save button and the Library grid agree without re-reading the store.
 */
class SavedAlbums {
  items = $state<SavedAlbum[]>([])

  private loaded = false
  private loading = false

  has(id: string): boolean {
    return this.items.some((album) => album.id === id)
  }

  async load(force = false): Promise<void> {
    if (this.loading || (this.loaded && !force)) return
    this.loading = true
    try {
      this.items = await api.library.albums()
      this.loaded = true
    } finally {
      this.loading = false
    }
  }

  async toggle(album: SavedAlbum): Promise<boolean> {
    const res = await api.library.toggleAlbum(album)
    this.items = res.albums
    this.loaded = true
    return res.saved
  }
}

export const savedAlbums = new SavedAlbums()
