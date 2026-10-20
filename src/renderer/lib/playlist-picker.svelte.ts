import type { Track } from '@shared/types'

/**
 * A single add-to-playlist popover, anchored to whatever row asked for it. One
 * instance lives in the app root so every track row can use it without prop
 * drilling.
 */
class PlaylistPicker {
  open = $state(false)
  track = $state<Track | null>(null)
  x = $state(0)
  y = $state(0)

  show(track: Track, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect()
    const width = 248
    const height = 280

    this.track = track
    this.x = Math.min(rect.left, window.innerWidth - width - 16)
    this.y = Math.min(rect.bottom + 6, window.innerHeight - height - 16)
    this.open = true
  }

  close(): void {
    this.open = false
    this.track = null
  }
}

export const playlistPicker = new PlaylistPicker()
