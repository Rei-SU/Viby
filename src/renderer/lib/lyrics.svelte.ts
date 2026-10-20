import type { Lyrics, Track } from '@shared/types'
import { api } from './api'

/**
 * Lyrics state shared by the player button and the panel. Results are cached in
 * the renderer for the session (the main process also persists them per track),
 * so reopening the panel or replaying a song is instant.
 */
class LyricsState {
  open = $state(false)
  loading = $state(false)
  error = $state<string | null>(null)
  data = $state<Lyrics | null>(null)

  private trackId: string | null = null
  private cache = new Map<string, Lyrics>()

  async toggle(track: Track | null): Promise<void> {
    if (this.open) {
      this.open = false
      return
    }
    this.open = true
    if (track) await this.load(track)
  }

  close(): void {
    this.open = false
  }

  async load(track: Track): Promise<void> {
    if (!track?.id) return
    if (this.trackId === track.id && this.data) return

    const cached = this.cache.get(track.id)
    if (cached) {
      this.trackId = track.id
      this.data = cached
      this.error = null
      return
    }

    this.trackId = track.id
    this.data = null
    this.loading = true
    this.error = null

    const res = await api.lyrics.get({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      album: track.album
    })

    // The user may have skipped to another track while this was in flight.
    if (this.trackId !== track.id) return

    this.loading = false
    if (res.ok) {
      this.data = res.data
      this.cache.set(track.id, res.data)
    } else {
      this.error = res.error
    }
  }
}

export const lyrics = new LyricsState()
