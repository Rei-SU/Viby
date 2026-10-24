import { api } from './api'
import { nav } from './nav.svelte'

/**
 * Open an album page from any context.
 *
 * Catalog rows carry a browse id. Saved tracks, downloaded collections and
 * older history entries may not, so look the album up once on click instead of
 * rendering the name as dead text.
 */
export function openAlbum(id: string | undefined, name: string, thumbnail?: string): void {
  if (id) {
    nav.open({ id, browseId: id, kind: 'album', title: name, subtitle: 'Album', thumbnail })
    return
  }
  void lookup(name)
}

async function lookup(name: string): Promise<void> {
  const query = name.trim()
  if (!query) return

  const res = await api.catalog.search(query, 'albums')
  if (!res.ok) return

  const match = res.data.find((item) => item.kind === 'album' && item.browseId)
  if (match) nav.open(match)
}
