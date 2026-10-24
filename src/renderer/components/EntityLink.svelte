<script lang="ts">
  import { openAlbum } from '../lib/album'
  import { openArtist } from '../lib/artist'

  let {
    kind,
    id,
    name,
    thumbnail
  }: {
    kind: 'artist' | 'album'
    id?: string
    name: string
    thumbnail?: string
  } = $props()

  function open(event: MouseEvent): void {
    // Rows and cards are clickable as a whole; the name must win instead of
    // triggering playback or opening the parent page.
    event.stopPropagation()
    if (kind === 'artist') openArtist(id, name, thumbnail)
    else openAlbum(id, name, thumbnail)
  }
</script>

<button
  type="button"
  class="entity-link inline-link"
  data-entity={kind}
  title={kind === 'artist' ? `Open artist ${name}` : `Open album ${name}`}
  onclick={open}
>
  {name}
</button>

<style>
  .entity-link {
    display: inline;
    padding: 0;
    color: var(--text-dim);
    font: inherit;
    text-align: left;
    pointer-events: auto;
    transition: color var(--speed) var(--ease);
  }

  .entity-link:hover {
    color: var(--text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
