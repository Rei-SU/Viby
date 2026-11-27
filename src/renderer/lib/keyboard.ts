import { favorites } from './favorites.svelte'
import { player } from './player.svelte'
import { connect } from './connect.svelte'
import { playlistPicker } from './playlist-picker.svelte'
import { sidePanel } from './side-panel.svelte'
import { changelog } from './changelog.svelte'

/**
 * Player-wide keyboard shortcuts.
 *
 * Deliberately narrow: text fields, selects, ranges and checkboxes keep their
 * own keys (typing, arrows, toggles). Native buttons and links are not exempt
 * from Space, because the common case is clicking a song row or card and then
 * pressing Space to pause — a focused control should not replay the row.
 */
const SEEK_STEP = 5
const VOLUME_STEP = 0.05

function isFormControl(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
}

export function installShortcuts(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return
    // The What's New sheet owns the keyboard while it is open; its own handler
    // closes it, and Space must not start playback behind it.
    if (changelog.open) return

    if (event.key === 'Escape') {
      // The playlist picker owns Escape while it is open.
      if (playlistPicker.open) return
      if (sidePanel.open) {
        event.preventDefault()
        sidePanel.close()
      }
      return
    }

    if (isFormControl(event.target) || event.altKey) return

    const mod = event.metaKey || event.ctrlKey

    // The keys drive whatever the player bar is showing: when another device
    // owns the session, transport keys follow it instead of the hidden local
    // player (Spotify behaves the same way from a controller window).
    const remote = connect.remote

    if (event.code === 'Space') {
      event.preventDefault()
      if (mod || event.repeat) return
      if (remote) void connect.remotePlayPause(remote)
      else player.toggle()
      return
    }

    if (mod && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      if (remote) {
        if (event.key === 'ArrowRight') void connect.remoteNext(remote)
        else void connect.remotePrevious(remote)
      } else if (event.key === 'ArrowRight') player.next()
      else player.previous()
      return
    }

    if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 1 : -1
      if (remote) {
        const volume = Math.max(0, Math.min(1, remote.volume + direction * VOLUME_STEP))
        void connect.remoteVolume(remote, volume)
      } else {
        player.setVolume(Math.max(0, Math.min(1, player.volume + direction * VOLUME_STEP)))
      }
      return
    }

    if (mod) return

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const direction = event.key === 'ArrowRight' ? 1 : -1
      if (remote) {
        if (!remote.track) return
        event.preventDefault()
        const elapsed = connect.devicePosition(remote)
        const limit = remote.track.durationSec > 0 ? remote.track.durationSec : elapsed
        const target = Math.max(0, Math.min(limit, elapsed + direction * SEEK_STEP))
        void connect.remoteSeek(remote, remote.track.id, target)
        return
      }
      if (!player.current) return
      event.preventDefault()
      const target = player.position + direction * SEEK_STEP
      const limit = player.duration > 0 ? player.duration : target
      player.seek(Math.max(0, Math.min(limit, target)))
      return
    }

    if (event.repeat) return

    switch (event.key.toLowerCase()) {
      case 'm':
      case 's':
      case 'r':
        // Mute, shuffle and repeat configure this computer; while a remote
        // session owns the bar they are hidden, so the keys do nothing.
        if (remote) return
        event.preventDefault()
        if (event.key.toLowerCase() === 'm') player.toggleMute()
        else if (event.key.toLowerCase() === 's') player.toggleShuffle()
        else player.cycleRepeat()
        break
      case 'l': {
        const track = remote ? connect.trackOf(remote) : player.current
        if (!track) return
        event.preventDefault()
        void favorites.toggle(track).catch(() => undefined)
        break
      }
      default:
        break
    }
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}
