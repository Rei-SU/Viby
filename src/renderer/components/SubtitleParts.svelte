<script lang="ts">
  import type { SubtitlePart } from '@shared/types'
  import { creditRange, isArtistName } from '@shared/artist-credits'
  import EntityLink from './EntityLink.svelte'

  let {
    parts = [],
    fallback = ''
  }: {
    parts?: SubtitlePart[]
    fallback?: string
  } = $props()

  /**
   * Some featured credits arrive without a browse id. They still belong to the
   * leading artist run, so link them by name (verified on click) instead of
   * leaving a dead name in the middle of three working ones.
   */
  const credit = $derived(creditRange(parts))

  function isNamedCredit(index: number): boolean {
    return index >= credit[0] && index < credit[1] && isArtistName(parts[index])
  }
</script>

{#if parts.length > 0}
  {#each parts as part, i (i)}
    {#if part.entity === 'artist' || part.artistId}
      <EntityLink kind="artist" id={part.artistId} name={part.text} />
    {:else if part.entity === 'album' || part.albumId}
      <EntityLink kind="album" id={part.albumId} name={part.text} artist={part.artistName} />
    {:else if isNamedCredit(i)}
      <EntityLink kind="artist" name={part.text} />
    {:else}
      <span>{part.text}</span>
    {/if}
  {/each}
{:else}
  {fallback}
{/if}
