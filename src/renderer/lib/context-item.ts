import type { Action } from 'svelte/action'
import { buildContextEntries, type ContextSubject } from './context-menu-entries'
import { contextMenu } from './context-menu.svelte'

/**
 * Apply to any row or card. Right-click, the Context Menu key, and Shift+F10
 * all dispatch `contextmenu`; the builder decides which actions make sense.
 */
export const contextItem: Action<HTMLElement, ContextSubject | null> = (node, initial) => {
  let subject = initial

  function onContextMenu(event: MouseEvent): void {
    if (!subject) return
    try {
      const entries = buildContextEntries(subject, node)
      if (entries.length > 0) contextMenu.show(event, entries, node)
    } catch (err) {
      // Never let a menu-build mistake break right-click on the row.
      console.warn('[context-menu] could not build entries', err)
    }
  }

  node.addEventListener('contextmenu', onContextMenu)
  return {
    update(next: ContextSubject | null) {
      subject = next
    },
    destroy() {
      node.removeEventListener('contextmenu', onContextMenu)
    }
  }
}
