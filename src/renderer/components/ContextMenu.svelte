<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { contextMenu, type MenuAction, type MenuSubmenu } from '../lib/context-menu.svelte'
  import { nav } from '../lib/nav.svelte'
  import Icon from './Icon.svelte'

  let menuEl = $state<HTMLDivElement>()
  let submenuEl = $state<HTMLDivElement>()
  let submenuIndex = $state<number | null>(null)
  let submenuAnchor = $state<HTMLElement | null>(null)
  let submenuX = $state(0)
  let submenuY = $state(0)
  let submenuQuery = $state('')
  let submenuTimer: ReturnType<typeof setTimeout> | null = null

  const submenu = $derived<MenuSubmenu | null>(
    submenuIndex === null
      ? null
      : contextMenu.entries[submenuIndex]?.type === 'submenu'
        ? (contextMenu.entries[submenuIndex] as MenuSubmenu)
        : null
  )

  const submenuEntries = $derived.by(() => {
    if (!submenu) return []
    const entries = submenu.items().filter((entry) => entry.type !== 'submenu')
    const query = submenuQuery.trim().toLowerCase()
    if (!query) return entries
    return entries.filter(
      (entry) => entry.type === 'action' && entry.label.toLowerCase().includes(query)
    )
  })

  function portal(node: HTMLElement): { destroy: () => void } {
    document.body.appendChild(node)
    return { destroy: () => node.remove() }
  }

  function cancelSubmenuClose(): void {
    if (submenuTimer) clearTimeout(submenuTimer)
    submenuTimer = null
  }

  function resetSubmenu(): void {
    cancelSubmenuClose()
    submenuIndex = null
    submenuAnchor = null
    submenuQuery = ''
  }

  function scheduleSubmenuClose(): void {
    if (submenuIndex === null) return
    cancelSubmenuClose()
    submenuTimer = setTimeout(() => {
      submenuTimer = null
      submenuIndex = null
      submenuAnchor = null
      submenuQuery = ''
    }, 180)
  }

  function openSubmenu(index: number, anchor: HTMLElement): void {
    const entry = contextMenu.entries[index]
    if (entry?.type !== 'submenu' || entry.disabled) return
    cancelSubmenuClose()
    if (submenuIndex !== index) submenuQuery = ''
    submenuIndex = index
    submenuAnchor = anchor

    const rect = anchor.getBoundingClientRect()
    const width = 248
    const estimated =
      8 +
      (entry.search ? 38 : 0) +
      (entry.create ? 34 : 0) +
      Math.max(1, entry.items().length) * 34 +
      10
    submenuX =
      rect.right + 6 + width <= window.innerWidth - 8
        ? rect.right + 6
        : Math.max(8, rect.left - width - 6)
    submenuY = Math.max(8, Math.min(rect.top - 6, window.innerHeight - estimated - 8))
  }

  function closeSubmenu(restoreFocus = false): void {
    const anchor = submenuAnchor
    resetSubmenu()
    if (restoreFocus && anchor) {
      requestAnimationFrame(() => anchor.focus())
    }
  }

  function focusFirstSubmenu(): void {
    void tick().then(() => {
      submenuEl?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
  }

  function run(entry: MenuAction | undefined): void {
    if (entry) void contextMenu.run(entry)
  }

  $effect(() => {
    if (!contextMenu.open) return
    void tick().then(() => {
      menuEl?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    })
  })

  $effect(() => {
    if (!contextMenu.open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (menuEl?.contains(target) || submenuEl?.contains(target)) return
      contextMenu.close(false)
    }
    const onDismiss = (event: Event): void => {
      const target = event.target as Node
      if (menuEl?.contains(target) || submenuEl?.contains(target)) return
      contextMenu.close(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  })

  $effect(() => {
    if (!contextMenu.open) resetSubmenu()
  })

  $effect(() => {
    // A new menu replaces any flyout from the previous one.
    contextMenu.entries
    resetSubmenu()
  })

  $effect(() => {
    // A navigation from a keyboard shortcut must not leave the menu floating.
    // Untracked: close() reads `open`, and tracking it here would make opening
    // the menu immediately re-run this effect and close it again.
    nav.revision
    untrack(() => contextMenu.close(false))
  })

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (submenuIndex !== null) closeSubmenu(true)
      else contextMenu.close(true)
      return
    }
    if (event.key === 'Tab') {
      contextMenu.close(true)
      return
    }
    if (event.key === 'ArrowRight') {
      const target = document.activeElement as HTMLElement | null
      const index = target?.dataset.submenuIndex
      if (index !== undefined) {
        event.preventDefault()
        openSubmenu(Number(index), target as HTMLElement)
        focusFirstSubmenu()
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()

    const items = [...(menuEl?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  function onSubmenuKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      closeSubmenu(true)
      return
    }
    if (event.key === 'Tab') {
      contextMenu.close(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()

    const items = [...(submenuEl?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  function onFilterKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    focusFirstSubmenu()
  }
</script>

{#if contextMenu.open}
  <div
    class="menu"
    role="menu"
    aria-label="Actions"
    tabindex="-1"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    bind:this={menuEl}
    use:portal
    onkeydown={onKeydown}
    oncontextmenu={(event) => event.preventDefault()}
  >
    {#each contextMenu.entries as entry, i (i)}
      {#if entry.type === 'separator'}
        <div class="sep" role="separator"></div>
      {:else if entry.type === 'submenu'}
        <button
          type="button"
          class="item"
          role="menuitem"
          tabindex="-1"
          aria-haspopup="menu"
          aria-expanded={submenuIndex === i}
          data-submenu-index={i}
          disabled={entry.disabled}
          onpointerenter={(event) => openSubmenu(i, event.currentTarget)}
          onpointerleave={scheduleSubmenuClose}
          onfocus={(event) => openSubmenu(i, event.currentTarget)}
          onclick={(event) => {
            event.stopPropagation()
            openSubmenu(i, event.currentTarget)
            focusFirstSubmenu()
          }}
        >
          {#if entry.icon}
            <Icon name={entry.icon} size={15} />
          {:else}
            <span class="icon-gap" aria-hidden="true"></span>
          {/if}
          <span class="label">{entry.label}</span>
          <Icon name="forward" size={11} />
        </button>
      {:else}
        <button
          type="button"
          class="item"
          class:danger={entry.danger}
          role="menuitem"
          tabindex="-1"
          disabled={entry.disabled}
          onpointerenter={scheduleSubmenuClose}
          onfocus={scheduleSubmenuClose}
          onclick={() => void contextMenu.run(entry)}
        >
          {#if entry.icon}
            <Icon name={entry.icon} size={15} />
          {:else}
            <span class="icon-gap" aria-hidden="true"></span>
          {/if}
          <span class="label">{entry.label}</span>
        </button>
      {/if}
    {/each}
  </div>

  {#if submenu}
    <div
      class="menu submenu"
      role="menu"
      aria-label={submenu.label}
      tabindex="-1"
      style="left: {submenuX}px; top: {submenuY}px"
      bind:this={submenuEl}
      use:portal
      onkeydown={onSubmenuKeydown}
      onpointerenter={cancelSubmenuClose}
      onpointerleave={scheduleSubmenuClose}
      oncontextmenu={(event) => event.preventDefault()}
    >
      {#if submenu.search}
        <input
          class="filter"
          bind:value={submenuQuery}
          placeholder="Find a playlist"
          aria-label="Find a playlist"
          onkeydown={onFilterKeydown}
        />
      {/if}

      {#if submenu.create}
        <button
          type="button"
          class="item"
          role="menuitem"
          tabindex="-1"
          onclick={() => run(submenu.create)}
        >
          {#if submenu.create.icon}
            <Icon name={submenu.create.icon} size={15} />
          {:else}
            <span class="icon-gap" aria-hidden="true"></span>
          {/if}
          <span class="label">{submenu.create.label}</span>
        </button>
      {/if}

      {#if submenu.search || submenu.create}
        <div class="sep" role="separator"></div>
      {/if}

      {#each submenuEntries as entry, i (i)}
        {#if entry.type === 'separator'}
          <div class="sep" role="separator"></div>
        {:else if entry.type === 'action'}
          <button
            type="button"
            class="item"
            class:danger={entry.danger}
            role="menuitem"
            tabindex="-1"
            disabled={entry.disabled}
            onclick={() => void contextMenu.run(entry)}
          >
            {#if entry.icon}
              <Icon name={entry.icon} size={15} />
            {:else}
              <span class="icon-gap" aria-hidden="true"></span>
            {/if}
            <span class="label">{entry.label}</span>
          </button>
        {/if}
      {/each}

      {#if submenu.search && submenuEntries.length === 0}
        <p class="empty">No playlists found.</p>
      {/if}
    </div>
  {/if}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 110;
    width: 248px;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    padding: 6px;
    border: 1px solid var(--stroke-strong);
    border-radius: 10px;
    background: var(--glass-strong);
    box-shadow: var(--shadow-card);
    backdrop-filter: blur(22px);
    animation: menu-in 90ms var(--ease);
  }

  .menu.submenu {
    z-index: 111;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: translateY(-3px) scale(0.985);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .menu {
      animation: none;
    }
  }

  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 32px;
    padding: 6px 9px;
    border-radius: 7px;
    color: var(--text-dim);
    font-size: 12.5px;
    text-align: left;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .item:hover:not(:disabled),
  .item:focus-visible {
    background: var(--glass-hover);
    color: var(--text);
    outline: none;
  }

  .item:disabled {
    color: var(--text-faint);
    cursor: default;
    opacity: 0.6;
  }

  .item.danger {
    color: var(--danger);
  }

  .label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-gap {
    width: 15px;
    flex: none;
  }

  .item :global(svg) {
    flex: none;
  }

  .sep {
    height: 1px;
    margin: 5px 9px;
    background: var(--stroke);
  }

  .filter {
    display: block;
    width: 100%;
    margin-bottom: 5px;
    padding: 7px 9px;
    border: 1px solid var(--stroke);
    border-radius: 7px;
    background: var(--glass);
    color: var(--text);
    font-size: 12.5px;
  }

  .filter:focus {
    border-color: var(--stroke-strong);
    outline: none;
  }

  .empty {
    margin: 7px 9px;
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
