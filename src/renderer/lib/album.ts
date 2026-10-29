import { pickAlbum } from './entity-lookup'
import { showEntitySearch } from './entity-search'
import { api } from './api'
import { nav } from './nav.svelte'

/**
 * Open an album, EP or single page from any context.
 *
 * Catalog rows carry a browse id. Saved tracks, downloaded collections and
 * history entries may not — and the same release title exists under many
 * artists. Only a result whose title and credited artist both match is opened;
 * otherwise the album search results are shown instead of a guessed release.
 */
export function openAlbum(
  id: string | undefined,
  name: string,
  thumbnail?: string,
  artist?: string
): void {
  if (id) {
    nav.open({ id, browseId: id, kind: 'album', title: name, subtitle: 'Album', thumbnail })
    return
  }
  void lookup(name, artist)
}

async function lookup(name: string, artist: string | undefined): Promise<void> {
  const title = name.trim()
  if (!title) return

  const query = [title, artist].filter(Boolean).join(' ')
  const res = await api.catalog.search(query, 'albums')
  if (!res.ok) return

  const match = pickAlbum(res.data, title, artist)
  if (match) {
    nav.open(match)
    return
  }
  showEntitySearch(title, 'albums')
}
