<script lang="ts">
  import type { ChangelogEntry } from '@shared/types'
  import { changelog } from '../lib/changelog.svelte'
  import Icon from './Icon.svelte'

  let sheet = $state<HTMLElement>()

  const primary = $derived(changelog.entries[0])

  function formatDate(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) return ''
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(date)
  }

  function sectionLabels(entry: ChangelogEntry): boolean {
    return entry.sections.length > 1
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!changelog.open) return

    if (event.key === 'Escape') {
      event.preventDefault()
      void changelog.dismiss()
      return
    }

    // Keep Tab inside the sheet; there is nothing behind it to reach.
    if (event.key !== 'Tab' || !sheet) return
    const focusable = [
      ...sheet.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')
    ].filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === sheet)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // The sheet is the only thing in the dialog, so focus it on open. That also
  // gives Escape a target without stealing focus from a control behind it.
  $effect(() => {
    if (changelog.open && sheet) sheet.focus()
  })
</script>

<svelte:window onkeydown={onKeydown} />

{#if changelog.open && primary}
  <div class="scrim" role="presentation" onclick={() => void changelog.dismiss()}></div>

  <div
    class="sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="changelog-title"
    tabindex="-1"
    bind:this={sheet}
  >
    <header>
      <div class="heading">
        <p class="eyebrow">What's new</p>
        <h2 id="changelog-title">Viby {primary.version}</h2>
        {#if primary.date}
          <p class="released">Released {formatDate(primary.date)}</p>
        {/if}
      </div>
      <button
        class="close"
        aria-label="Close what's new"
        onclick={() => void changelog.dismiss()}
      >
        <Icon name="close" size={15} />
      </button>
    </header>

    <div class="body scroll">
      {#each changelog.entries as entry, index (entry.version)}
        <section class="release" class:older={index > 0}>
          {#if index > 0}
            <h3>
              <a href={entry.url} target="_blank" rel="noreferrer">Viby {entry.version}</a>
              {#if entry.date}<span>{formatDate(entry.date)}</span>{/if}
            </h3>
          {/if}

          {#each entry.sections as section}
            {#if sectionLabels(entry)}
              <p class="section-title">{section.title}</p>
            {/if}
            <ul>
              {#each section.items as item}
                <li>{item}</li>
              {/each}
            </ul>
          {/each}
        </section>
      {/each}

      {#if changelog.earlier > 0}
        <p class="earlier">
          And {changelog.earlier} earlier update{changelog.earlier === 1 ? '' : 's'}.
        </p>
      {/if}
    </div>

    <footer>
      <a class="notes" href={primary.url} target="_blank" rel="noreferrer">Full notes</a>
      <button class="done" onclick={() => void changelog.dismiss()}>Close</button>
    </footer>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(4, 4, 7, 0.6);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    animation: scrim-in 180ms var(--ease);
  }

  .sheet {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 121;
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 48px));
    max-height: min(660px, calc(100vh - 80px));
    padding: 30px 32px 22px;
    border: 1px solid var(--stroke-strong);
    border-radius: 20px;
    background: #121218;
    box-shadow:
      0 40px 90px rgba(0, 0, 0, 0.66),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    transform: translate(-50%, -50%);
    animation: sheet-in 220ms var(--ease);
  }

  .sheet:focus {
    outline: none;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    flex-shrink: 0;
  }

  .heading {
    min-width: 0;
  }

  .eyebrow {
    margin: 0 0 9px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 640;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  .released {
    margin: 7px 0 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 8px;
    color: var(--text-faint);
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .close:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    margin: 22px -10px 0;
    padding: 0 10px;
  }

  .release + .release {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid var(--stroke);
  }

  .release h3 {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 14px;
    font-size: 13.5px;
    font-weight: 600;
  }

  .release h3 a {
    color: var(--text);
    text-decoration: none;
  }

  .release h3 a:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .release h3 span {
    color: var(--text-faint);
    font-size: 12px;
    font-weight: 400;
  }

  .section-title {
    margin: 20px 0 9px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .release > :first-child,
  .section-title:first-child {
    margin-top: 0;
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 9px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    position: relative;
    padding-left: 17px;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.6;
  }

  li::before {
    content: '';
    position: absolute;
    top: 0.68em;
    left: 3px;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-faint);
  }

  .earlier {
    margin: 20px 0 0;
    color: var(--text-faint);
    font-size: 12px;
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-shrink: 0;
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--stroke);
  }

  .notes {
    color: var(--text-dim);
    font-size: 12px;
    text-decoration: none;
  }

  .notes:hover {
    color: var(--text);
  }

  .done {
    height: 32px;
    padding: 0 18px;
    border-radius: 999px;
    background: var(--accent);
    color: #08080b;
    font-size: 12.5px;
    font-weight: 600;
    transition: background var(--speed) var(--ease);
  }

  .done:hover {
    background: var(--accent-strong);
  }

  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translate(-50%, calc(-50% + 10px));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrim,
    .sheet {
      animation: none;
    }
  }
</style>
