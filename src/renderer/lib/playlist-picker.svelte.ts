import type { Track } from '@shared/types'

/**
 * A single add-to-playlist popover, anchored to whatever row asked for it. One
 * instance lives in the app root so every track row can use it without prop
 * drilling. It accepts a list so album and EP menus can add every track at once.
 */
class PlaylistPicker {
  open = $state(false)
  tracks = $state<Track[]>([])
  /** Open directly on the "New playlist" form. */
  creating = $state(false)
  x = $state(0)
  y = $state(0)

  show(track: Track, anchor: HTMLElement): void {
    this.showMany([track], anchor)
  }

  showMany(tracks: Track[], anchor: HTMLElement): void {
    this.position(tracks, anchor, false)
  }

  showNew(tracks: Track[], anchor: HTMLElement): void {
    this.position(tracks, anchor, true)
  }

  private position(tracks: Track[], anchor: HTMLElement, creating: boolean): void {
    const valid = tracks.filter((track) => track?.id)
    if (valid.length === 0) return
    const rect = anchor.getBoundingClientRect()
    const width = 248
    const height = 280

    this.tracks = valid.map((track) => ({ ...track }))
    this.creating = creating
    this.x = Math.min(rect.left, window.innerWidth - width - 16)
    this.y = Math.min(rect.bottom + 6, window.innerHeight - height - 16)
    this.open = true
  }

  close(): void {
    this.open = false
    this.tracks = []
    this.creating = false
  }
}

export const playlistPicker = new PlaylistPicker()
