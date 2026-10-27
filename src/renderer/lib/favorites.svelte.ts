import type { Track } from '@shared/types'
import { api } from './api'
import { plainTrack } from './track'

/**
 * Liked songs, mirrored in the renderer so every heart (player bar, history
 * rows) reflects the same state without re-reading the store per row.
 */
class Favorites {
  ids = $state<Set<string>>(new Set())

  private loaded = false
  private loading = false

  has(id: string): boolean {
    return this.ids.has(id)
  }

  async load(force = false): Promise<void> {
    if (this.loading || (this.loaded && !force)) return
    this.loading = true
    try {
      const list = await api.favorites.list()
      this.ids = new Set(list.map((track) => track.id))
      this.loaded = true
    } finally {
      this.loading = false
    }
  }

  async toggle(track: Track): Promise<boolean> {
    const res = await api.favorites.toggle(plainTrack(track))
    this.ids = new Set(res.favorites.map((entry) => entry.id))
    this.loaded = true
    return res.favorited
  }
}

export const favorites = new Favorites()
