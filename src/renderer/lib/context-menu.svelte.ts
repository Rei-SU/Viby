import { toast } from './toast.svelte'

export type MenuIcon =
  | 'play'
  | 'pause'
  | 'forward'
  | 'queueAdd'
  | 'plus'
  | 'heart'
  | 'download'
  | 'check'
  | 'close'
  | 'user'
  | 'disc'
  | 'alert'

export type MenuAction = {
  type: 'action'
  label: string
  icon?: MenuIcon
  disabled?: boolean
  danger?: boolean
  run: () => void | Promise<void>
}

export type MenuSubmenu = {
  type: 'submenu'
  label: string
  icon?: MenuIcon
  disabled?: boolean
  /** Render a filter field above the entries. */
  search?: boolean
  /** Pinned action above the list, e.g. Create playlist. */
  create?: MenuAction
  /** Evaluated while the flyout is open, so it can track playlist changes. */
  items: () => MenuEntry[]
}

export type MenuEntry = MenuAction | MenuSubmenu | { type: 'separator' }

/**
 * One app-wide context menu. Rows and cards open it through the `contextItem`
 * action; this store owns position, focus return and action errors.
 */
class ContextMenuState {
  open = $state(false)
  x = $state(0)
  y = $state(0)
  entries = $state<MenuEntry[]>([])

  private returnFocus: HTMLElement | null = null

  show(event: MouseEvent, entries: MenuEntry[], anchor: HTMLElement): void {
    if (entries.length === 0) return
    event.preventDefault()
    event.stopPropagation()

    this.entries = entries
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : anchor

    // Estimate the height from the rows; flip above the pointer near the bottom.
    const width = 248
    const height = 8 + entries.reduce((sum, entry) => sum + (entry.type === 'separator' ? 9 : 34), 0)
    let x = event.clientX
    let y = event.clientY
    if (x === 0 && y === 0) {
      // Keyboard (Context Menu key / Shift+F10): anchor to the row instead of
      // the top-left corner of the window.
      const rect = anchor.getBoundingClientRect()
      x = rect.left + Math.min(24, rect.width / 2)
      y = rect.bottom
    }
    this.x = Math.max(8, Math.min(x, window.innerWidth - width - 8))
    this.y = Math.max(8, y + height + 8 > window.innerHeight ? y - height : y)
    this.open = true
  }

  close(restoreFocus = false): void {
    if (!this.open) return
    const target = this.returnFocus
    this.open = false
    this.entries = []
    this.returnFocus = null
    if (restoreFocus && target?.isConnected) {
      requestAnimationFrame(() => target.focus())
    }
  }

  async run(entry: MenuAction): Promise<void> {
    if (entry.disabled) return
    this.close()
    try {
      await entry.run()
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'That action could not be completed.')
    }
  }
}

export const contextMenu = new ContextMenuState()
