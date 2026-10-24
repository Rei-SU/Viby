<script lang="ts">
  import type { SubtitlePart } from '@shared/types'
  import EntityLink from './EntityLink.svelte'

  let {
    parts = [],
    fallback = '',
    linkPlainArtists = false
  }: {
    parts?: SubtitlePart[]
    fallback?: string
    /** Playlist cards list featured artists as plain text. */
    linkPlainArtists?: boolean
  } = $props()

  function looksLikeArtist(text: string): boolean {
    const value = text.trim()
    if (!value) return false
    if (/^[\s·,•&/]+$/.test(value)) return false
    if (/^(playlist|album|single|ep|youtube music)$/i.test(value)) return false
    if (/^\d[\d.,]*\s*[KMB]?\s*(views?|plays?|likes?)$/i.test(value)) return false
    if (/^\d+\s+(songs?|tracks?)$/i.test(value)) return false
    if (/^\d+:\d+$/.test(value)) return false
    return true
  }
</script>

{#if parts.length > 0}
  {#each parts as part, i (i)}
    {#if part.entity === 'artist' || part.artistId}
      <EntityLink kind="artist" id={part.artistId} name={part.text} />
    {:else if part.entity === 'album' || part.albumId}
      <EntityLink kind="album" id={part.albumId} name={part.text} />
    {:else if linkPlainArtists && looksLikeArtist(part.text)}
      <EntityLink kind="artist" name={part.text} />
    {:else}
      <span>{part.text}</span>
    {/if}
  {/each}
{:else}
  {fallback}
{/if}
