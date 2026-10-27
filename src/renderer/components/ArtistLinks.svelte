<script lang="ts">
  import type { SubtitlePart } from '@shared/types'
  import { artistPartsFor, isArtistName } from '@shared/artist-credits'
  import { openArtist } from '../lib/artist'

  let {
    parts,
    name,
    id
  }: {
    /** Structured credits when the caller has them (catalog rows, saved tracks). */
    parts?: SubtitlePart[]
    /** Display string; used to derive parts when none were stored. */
    name: string
    /** Primary artist id, for the common single-artist case. */
    id?: string
  } = $props()

  // Stored credits win; otherwise split the display string so a featuring is
  // still reachable from an old history entry or a yt-dlp-resolved track.
  const credits = $derived(parts?.length ? parts : artistPartsFor({ artist: name, artistId: id }))
</script>

{#each credits as part, i (i)}
  {#if isArtistName(part)}
    <button
      type="button"
      class="artist-link"
      title={`Open ${part.text.trim()}`}
      onclick={(event) => {
        event.stopPropagation()
        openArtist(part.artistId, part.text.trim())
      }}>{part.text.trim()}</button
    >
  {:else}
    <span class="sep">{part.text}</span>
  {/if}
{/each}{#if credits.length === 0 && name}
  <span class="fallback">{name}</span>
{/if}

<style>
  .artist-link {
    display: inline;
    padding: 0;
    color: inherit;
    font: inherit;
    text-align: left;
    transition: color var(--speed) var(--ease);
  }

  .artist-link:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
