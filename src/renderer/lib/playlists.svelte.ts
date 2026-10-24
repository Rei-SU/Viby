import type { Playlist, Track } from '@shared/types'
import { api } from './api'

/**
 * User playlists, mirrored in the renderer so every surface stays in sync after
 * a create / add / remove without re-fetching the whole library.
 */
class Playlists {
  items = $state<Playlist[]>([])
  loaded = $state(false)
  /**
   * Bumped by every local mutation. A `load()` that started before a mutation
   * must not overwrite the newer state when it returns.
   */
  private generation = 0

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return
    const generation = ++this.generation
    const items = await api.library.playlists()
    if (generation !== this.generation) return
    this.items = items
    this.loaded = true
  }

  byId(id: string): Playlist | null {
    return this.items.find((playlist) => playlist.id === id) ?? null
  }

  async create(name: string): Promise<Playlist> {
    const generation = ++this.generation
    const playlist = await api.library.createPlaylist(name)
    if (generation === this.generation) this.items = [playlist, ...this.items]
    return playlist
  }

  async rename(id: string, name: string): Promise<void> {
    const generation = ++this.generation
    const playlist = await api.library.renamePlaylist(id, name)
    if (playlist && generation === this.generation) this.replace(playlist)
  }

  async remove(id: string): Promise<void> {
    const generation = ++this.generation
    await api.library.deletePlaylist(id)
    if (generation === this.generation) {
      this.items = this.items.filter((playlist) => playlist.id !== id)
    }
  }

  async addTrack(id: string, track: Track): Promise<Playlist | null> {
    const generation = ++this.generation
    const playlist = await api.library.addToPlaylist(id, track)
    if (playlist && generation === this.generation) this.replace(playlist)
    return playlist
  }

  async removeTrack(id: string, trackId: string): Promise<void> {
    const generation = ++this.generation
    const playlist = await api.library.removeFromPlaylist(id, trackId)
    if (playlist && generation === this.generation) this.replace(playlist)
  }

  private replace(playlist: Playlist): void {
    this.items = this.items.map((item) => (item.id === playlist.id ? playlist : item))
  }
}

export const playlists = new Playlists()
