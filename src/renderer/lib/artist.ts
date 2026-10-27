import { api } from './api'
import { nav } from './nav.svelte'

/**
 * Open an artist page from any context.
 *
 * Catalog rows carry a browse id, but tracks rebuilt from history — or resolved
 * by yt-dlp — may not. Rather than rendering those names as dead text, look the
 * artist up once on click.
 */
export function openArtist(id: string | undefined, name: string, thumbnail?: string): void {
  if (id) {
    nav.openArtist(id, name, thumbnail)
    return
  }
  void lookup(name)
}

async function lookup(name: string): Promise<void> {
  // Older callers may still pass a combined credit string; the first name is
  // the one the link was about.
  const query = name.split(/[,&]/)[0]?.trim() || name.trim()
  if (!query) return

  const res = await api.catalog.search(query, 'artists')
  if (!res.ok) return

  // Search is fuzzy; prefer the artist whose name is exactly what was clicked
  // ("Manal" must not open the first similar-sounding artist).
  const wanted = normalize(query)
  const match =
    res.data.find(
      (item) => item.kind === 'artist' && item.browseId && normalize(item.title) === wanted
    ) ?? res.data.find((item) => item.kind === 'artist' && item.browseId)
  if (match?.browseId) nav.openArtist(match.browseId, match.title, match.thumbnail)
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
