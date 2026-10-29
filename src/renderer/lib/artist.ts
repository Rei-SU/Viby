import { api } from './api'
import { pickArtist } from './entity-lookup'
import { showEntitySearch } from './entity-search'
import { nav } from './nav.svelte'

/**
 * Open an artist page from any context.
 *
 * Catalog rows carry a browse id; tracks rebuilt from history or resolved by
 * yt-dlp may not. A name-only search only ever opens an exact name match —
 * anything else would be a different artist — and otherwise shows the search
 * results so the user can pick.
 */
export function openArtist(id: string | undefined, name: string, thumbnail?: string): void {
  if (id) {
    nav.openArtist(id, name, thumbnail)
    return
  }
  void lookup(name)
}

async function lookup(name: string): Promise<void> {
  // Do not split the name: "Tyler, The Creator" and "Earth, Wind & Fire" are
  // single artists, and splitting them searches for a different person.
  const query = name.trim()
  if (!query) return

  const res = await api.catalog.search(query, 'artists')
  if (!res.ok) return

  const match = pickArtist(res.data, query)
  if (match?.browseId) {
    nav.openArtist(match.browseId, match.title, match.thumbnail)
    return
  }
  showEntitySearch(query, 'artists')
}
