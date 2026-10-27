<script lang="ts">
  import type {
    ImportMatch,
    ImportProgress,
    ImportSource,
    Playlist,
    Track
  } from '@shared/types'
  import { onMount } from 'svelte'
  import { api } from '../lib/api'
  import { nav } from '../lib/nav.svelte'
  import { playlists } from '../lib/playlists.svelte'
  import { plainTrack } from '../lib/track'
  import Cover from './Cover.svelte'
  import Icon from './Icon.svelte'
  import InlineAlert from './InlineAlert.svelte'

  type Phase = 'idle' | 'resolving' | 'matching' | 'review' | 'creating' | 'done'
  type Row = { match: ImportMatch; include: boolean; chosenId: string | null }

  let phase = $state<Phase>('idle')
  let url = $state('')
  let source = $state<ImportSource | null>(null)
  let rows = $state<Row[]>([])
  let error = $state<string | null>(null)
  let progress = $state<ImportProgress>({ done: 0, total: 0 })
  let name = $state('')
  let created = $state<Playlist | null>(null)
  // Every submit/cancel gets a new generation. A late response from an older
  // attempt must not replace the playlist the user is looking at now.
  let attempt = 0

  const busy = $derived(phase === 'resolving' || phase === 'matching' || phase === 'creating')
  const autoCount = $derived(rows.filter((row) => row.match.status === 'auto').length)
  const reviewCount = $derived(rows.filter((row) => row.match.status === 'review').length)
  const missingCount = $derived(rows.filter((row) => row.match.status === 'missing').length)
  const selected = $derived(
    rows
      .filter((row) => row.include && row.chosenId)
      .map(candidateOf)
      .filter((track): track is Track => Boolean(track))
  )

  onMount(() => {
    return api.import.onProgress((next) => {
      if (phase === 'matching') progress = next
    })
  })

  function candidateOf(row: Row): Track | null {
    if (!row.chosenId) return null
    return row.match.candidates.find((candidate) => candidate.id === row.chosenId) ?? null
  }

  function reset(): void {
    phase = 'idle'
    url = ''
    source = null
    rows = []
    error = null
    progress = { done: 0, total: 0 }
    name = ''
    created = null
    attempt += 1
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    const value = url.trim()
    if (!value || busy) return

    const mine = ++attempt
    source = null
    rows = []
    created = null
    error = null
    phase = 'resolving'

    const resolved = await api.import.resolve(value)
    if (mine !== attempt) return
    if (!resolved.ok) {
      error = resolved.error
      phase = 'idle'
      return
    }

    source = resolved.data
    name = source.title
    progress = { done: 0, total: source.tracks.length }
    phase = 'matching'

    const matched = await api.import.match($state.snapshot(source) as ImportSource)
    if (mine !== attempt) return
    if (!matched.ok) {
      error = matched.error
      phase = 'idle'
      return
    }

    rows = matched.data.map((match) => ({
      match,
      include: match.status === 'auto',
      chosenId: match.candidate?.id ?? null
    }))
    phase = 'review'
  }

  function cancel(): void {
    attempt += 1
    void api.import.cancel()
    phase = 'idle'
    source = null
    rows = []
    progress = { done: 0, total: 0 }
  }

  function choose(row: Row, event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value
    row.chosenId = value || null
    row.include = Boolean(value)
  }

  function toggle(row: Row): void {
    if (!candidateOf(row)) return
    row.include = !row.include
  }

  function selectAll(value: boolean): void {
    for (const row of rows) if (row.chosenId) row.include = value
  }

  async function create(): Promise<void> {
    if (!source || selected.length === 0 || phase === 'creating') return

    // Matched tracks live in Svelte state; IPC rejects the proxies that
    // artistParts now nests inside them.
    const tracks = selected.map(plainTrack)
    phase = 'creating'
    error = null

    const res = await api.import.create({
      name: name.trim() || source.title,
      tracks
    })

    if (!res.ok) {
      error = res.error
      phase = 'review'
      return
    }

    created = res.data
    await playlists.load(true)
    phase = 'done'
  }

  function serviceName(service: ImportSource['service']): string {
    switch (service) {
      case 'spotify':
        return 'Spotify'
      case 'apple':
        return 'Apple Music'
      case 'deezer':
        return 'Deezer'
      case 'youtube':
        return 'YouTube Music'
      case 'soundcloud':
        return 'SoundCloud'
    }
  }

  function duration(seconds?: number): string {
    if (!seconds || seconds <= 0) return '—'
    const minutes = Math.floor(seconds / 60)
    return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, '0')}`
  }

  function artistsOf(track: ImportMatch['source']): string {
    return track.artists.join(', ') || 'Unknown artist'
  }

  function percent(): number {
    return progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  }
</script>

<div class="view">
  <header class="head">
    <h1>Import</h1>
    <p>
      Paste a playlist link from Spotify, Apple Music, Deezer or SoundCloud. No sign-in needed.
    </p>
  </header>

  {#if phase !== 'done'}
    <form class="url" onsubmit={submit}>
      <input
        type="text"
        inputmode="url"
        bind:value={url}
        placeholder="https://open.spotify.com/playlist/…"
        spellcheck="false"
        autocomplete="off"
        aria-label="Playlist link"
        disabled={busy}
      />
      <button type="submit" class="primary" disabled={!url.trim() || busy}>
        {phase === 'resolving' ? 'Reading…' : 'Import'}
      </button>
    </form>
  {/if}

  {#if error}
    <InlineAlert title="Import failed" message={error} />
  {/if}

  {#if phase === 'resolving'}
    <p class="status">Reading the playlist…</p>
  {:else if phase === 'matching'}
    <section class="matching">
      <div class="matching-head">
        <span>Matching {progress.done} of {progress.total}</span>
        <button class="ghost" onclick={cancel}>Cancel</button>
      </div>
      <div class="bar" aria-hidden="true"><span style="width: {percent()}%"></span></div>
      <p class="hint">Each source track is matched against the catalogue. Long playlists take a minute.</p>
    </section>
  {/if}

  {#if source && (phase === 'matching' || phase === 'review' || phase === 'creating')}
    <section class="source">
      <Cover src={source.cover} size={76} radius={12} alt={source.title} />
      <div class="source-text">
        <span class="eyebrow">{serviceName(source.service)} · {source.totalTracks} tracks</span>
        <h2>{source.title}</h2>
        {#if source.creator}<p class="creator">{source.creator}</p>{/if}

        {#if source.truncated}
          <p class="notice">
            Only the first {source.truncated.shown} tracks were available.
            {source.truncated.total ? `This playlist has ${source.truncated.total}.` : ''}
          </p>
        {/if}

        {#if source.service === 'spotify'}
          <p class="hint">Spotify playlists must be public. Private playlists cannot be read.</p>
        {/if}
      </div>
    </section>
  {/if}

  {#if source && (phase === 'review' || phase === 'creating')}
    <div class="summary">
      <div class="counts">
        <span><strong>{autoCount}</strong> matched</span>
        <span><strong>{reviewCount}</strong> to review</span>
        <span><strong>{missingCount}</strong> missing</span>
      </div>
      <div class="summary-actions">
        <button class="link" onclick={() => selectAll(true)}>Select all</button>
        <button class="link" onclick={() => selectAll(false)}>Clear</button>
        <button
          class="primary compact"
          disabled={selected.length === 0 || phase === 'creating'}
          onclick={create}
        >
          {phase === 'creating' ? 'Adding…' : `Import ${selected.length}`}
        </button>
      </div>
    </div>

    <div class="rows">
      {#each rows as row, index (index)}
        {@const target = candidateOf(row)}
        <div class="row">
          <button
            class="check"
            class:on={row.include}
            disabled={!target}
            onclick={() => toggle(row)}
            aria-label={row.include ? 'Exclude this track' : 'Include this track'}
            aria-pressed={row.include}
          >
            {#if row.include}<Icon name="check" size={13} />{/if}
          </button>

          <div class="from">
            <span class="title truncate">{row.match.source.title}</span>
            <span class="meta truncate">
              {artistsOf(row.match.source)}
              {row.match.source.durationSec ? ` · ${duration(row.match.source.durationSec)}` : ''}
            </span>
          </div>

          <div class="to">
            {#if target}
              <select
                value={row.chosenId ?? ''}
                onchange={(event) => choose(row, event)}
                aria-label="Best match for {row.match.source.title}"
              >
                {#each row.match.candidates as candidate (candidate.id)}
                  <option value={candidate.id}>
                    {candidate.title} — {candidate.artist}{candidate.durationSec
                      ? ` (${duration(candidate.durationSec)})`
                      : ''}
                  </option>
                {/each}
              </select>
            {:else}
              <span class="none">No match found</span>
            {/if}
            <span class="chip {row.match.status}">
              {row.match.status === 'auto'
                ? 'Match'
                : row.match.status === 'review'
                  ? 'Review'
                  : 'Missing'}
            </span>
          </div>
        </div>
      {/each}
    </div>

    <div class="commit">
      <input bind:value={name} aria-label="Playlist name" placeholder="Playlist name" />
      <button
        class="primary"
        disabled={selected.length === 0 || phase === 'creating'}
        onclick={create}
      >
        {phase === 'creating'
          ? 'Adding…'
          : `Import ${selected.length} ${selected.length === 1 ? 'track' : 'tracks'}`}
      </button>
    </div>
  {/if}

  {#if phase === 'done' && created}
    <section class="done">
      <span class="done-icon"><Icon name="check" size={22} /></span>
      <h2>{created.name}</h2>
      <p>
        {created.tracks.length}
        {created.tracks.length === 1 ? 'track' : 'tracks'} added to your library.
      </p>
      <div class="done-actions">
        <button
          class="primary"
          onclick={() => created && nav.openCollection({ kind: 'playlist', id: created.id })}>Open playlist</button
        >
        <button class="ghost" onclick={reset}>Import another</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding: 4px 2px 28px;
    max-width: 940px;
  }

  .head h1 {
    font-size: 30px;
    font-weight: 640;
    margin: 0 0 6px;
    letter-spacing: -0.028em;
  }

  .head p {
    margin: 0;
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.6;
  }

  .url {
    display: flex;
    gap: 10px;
  }

  .url input {
    flex: 1;
    min-width: 0;
    background: var(--glass);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid var(--stroke);
    border-radius: 12px;
    padding: 11px 14px;
    color: var(--text);
    outline: none;
    font-size: 13px;
    transition: border-color var(--speed) var(--ease);
  }

  .url input:focus {
    border-color: var(--stroke-strong);
  }

  .url input::placeholder {
    color: var(--text-faint);
  }

  .primary {
    padding: 0 20px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 550;
    color: #08080b;
    background: var(--text);
    flex-shrink: 0;
  }

  .primary:disabled {
    background: var(--glass-active);
    color: var(--text-faint);
  }

  .primary.compact {
    padding: 6px 13px;
    border-radius: 999px;
    font-size: 12px;
  }

  .status {
    margin: 0;
    color: var(--text-faint);
    font-size: 13px;
  }

  .matching {
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
    background: var(--glass);
  }

  .matching-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
  }

  .bar {
    height: 3px;
    margin: 12px 0 9px;
    background: var(--glass-active);
    border-radius: 999px;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--text);
    transition: width 180ms var(--ease);
  }

  .hint {
    margin: 6px 0 0;
    color: var(--text-faint);
    font-size: 11.5px;
    line-height: 1.5;
  }

  .source {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }

  .source-text {
    min-width: 0;
  }

  .eyebrow {
    display: block;
    font-size: 10.5px;
    font-weight: 550;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .source h2 {
    margin: 5px 0 2px;
    font-size: 24px;
    font-weight: 620;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }

  .creator {
    margin: 0;
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .notice {
    margin: 8px 0 0;
    padding: 6px 9px;
    border: 1px solid var(--stroke);
    border-radius: 8px;
    color: var(--text-dim);
    font-size: 11.5px;
    width: fit-content;
  }

  .summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    font-size: 12.5px;
    color: var(--text-dim);
  }

  .counts {
    display: flex;
    gap: 16px;
  }

  .counts strong {
    color: var(--text);
    font-weight: 600;
  }

  .summary-actions {
    display: flex;
    gap: 14px;
  }

  .link {
    font-size: 12px;
    color: var(--text-faint);
    transition: color var(--speed) var(--ease);
  }

  .link:hover {
    color: var(--text);
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) minmax(230px, 1.05fr);
    align-items: center;
    gap: 12px;
    padding: 9px 0;
    border-top: 1px solid var(--stroke);
  }

  .check {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 1px solid var(--stroke-strong);
    border-radius: 5px;
    color: #08080b;
    background: transparent;
    transition:
      background var(--speed) var(--ease),
      border-color var(--speed) var(--ease);
  }

  .check.on {
    background: var(--text);
    border-color: var(--text);
  }

  .check:disabled {
    opacity: 0.3;
  }

  .from {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .title {
    font-size: 13px;
    color: var(--text);
  }

  .meta {
    font-size: 11.5px;
    color: var(--text-faint);
  }

  .to {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  select {
    flex: 1;
    min-width: 0;
    background: var(--glass);
    border: 1px solid var(--stroke);
    border-radius: 8px;
    padding: 6px 9px;
    color: var(--text-dim);
    font-size: 11.5px;
    text-overflow: ellipsis;
  }

  select:focus {
    outline: none;
    border-color: var(--stroke-strong);
    color: var(--text);
  }

  .none {
    flex: 1;
    color: var(--text-faint);
    font-size: 11.5px;
  }

  .chip {
    flex-shrink: 0;
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 1px 7px;
    font-size: 9.5px;
    font-weight: 550;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .chip.auto {
    border-color: var(--stroke-strong);
    color: var(--text);
  }

  .chip.review {
    color: var(--text-dim);
  }

  .commit {
    display: flex;
    gap: 10px;
    align-items: center;
    padding-top: 4px;
  }

  .commit input {
    flex: 1;
    max-width: 320px;
    background: var(--glass);
    border: 1px solid var(--stroke);
    border-radius: 10px;
    padding: 9px 12px;
    color: var(--text);
    outline: none;
    font-size: 12.5px;
  }

  .commit input:focus {
    border-color: var(--stroke-strong);
  }

  .ghost {
    border: 1px solid var(--stroke);
    border-radius: 999px;
    padding: 7px 14px;
    font-size: 12px;
    color: var(--text-dim);
    flex-shrink: 0;
    transition:
      background var(--speed) var(--ease),
      color var(--speed) var(--ease);
  }

  .ghost:hover {
    background: var(--glass-hover);
    color: var(--text);
  }

  .done {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    border: 1px solid var(--stroke);
    border-radius: var(--radius-lg);
    padding: 22px;
    background: var(--glass);
    max-width: 520px;
  }

  .done-icon {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--text);
    color: #08080b;
    margin-bottom: 6px;
  }

  .done h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 620;
    letter-spacing: -0.02em;
  }

  .done p {
    margin: 0;
    color: var(--text-dim);
    font-size: 12.5px;
  }

  .done-actions {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
</style>
