import type { Playlist, Track } from '@shared/types'
import { api } from './api'

/**
 * User playlists, mirrored in the renderer so every surface stays in sync after
 * a create / add / remove without re-fetching the whole library.
 */
class Playlists {
  items = $state<Playlist[]>([])
  loaded = $state(false)

  async load(force = false): Promise<void> {
    if (this.loaded && !force) return
    this.items = await api.library.playlists()
    this.loaded = true
  }

  byId(id: string): Playlist | null {
    return this.items.find((playlist) => playlist.id === id) ?? null
  }

  async create(name: string): Promise<Playlist> {
    const playlist = await api.library.createPlaylist(name)
    this.items = [playlist, ...this.items]
    return playlist
  }

  async rename(id: string, name: string): Promise<void> {
    const playlist = await api.library.renamePlaylist(id, name)
    if (playlist) this.replace(playlist)
  }

  async remove(id: string): Promise<void> {
    await api.library.deletePlaylist(id)
    this.items = this.items.filter((playlist) => playlist.id !== id)
  }

  async addTrack(id: string, track: Track): Promise<Playlist | null> {
    const playlist = await api.library.addToPlaylist(id, track)
    if (playlist) this.replace(playlist)
    return playlist
  }

  async removeTrack(id: string, trackId: string): Promise<void> {
    const playlist = await api.library.removeFromPlaylist(id, trackId)
    if (playlist) this.replace(playlist)
  }

  private replace(playlist: Playlist): void {
    this.items = this.items.map((item) => (item.id === playlist.id ? playlist : item))
  }
}

export const playlists = new Playlists()
