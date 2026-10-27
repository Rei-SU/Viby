import { favorites } from './favorites.svelte'
import { player } from './player.svelte'
import { playlistPicker } from './playlist-picker.svelte'
import { sidePanel } from './side-panel.svelte'

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

    if (event.code === 'Space') {
      event.preventDefault()
      if (mod || event.repeat) return
      player.toggle()
      return
    }

    if (mod && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault()
      if (event.key === 'ArrowRight') player.next()
      else player.previous()
      return
    }

    if (mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? 1 : -1
      player.setVolume(Math.max(0, Math.min(1, player.volume + direction * VOLUME_STEP)))
      return
    }

    if (mod) return

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      if (!player.current) return
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      const target = player.position + direction * SEEK_STEP
      const limit = player.duration > 0 ? player.duration : target
      player.seek(Math.max(0, Math.min(limit, target)))
      return
    }

    if (event.repeat) return

    switch (event.key.toLowerCase()) {
      case 'm':
        event.preventDefault()
        player.toggleMute()
        break
      case 's':
        event.preventDefault()
        player.toggleShuffle()
        break
      case 'r':
        event.preventDefault()
        player.cycleRepeat()
        break
      case 'l': {
        const track = player.current
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
