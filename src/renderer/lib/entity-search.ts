import type { SearchFilterName } from '@shared/types'
import { nav } from './nav.svelte'
import { searchState } from './search.svelte'

/**
 * When an entity link cannot be resolved with confidence, show the matching
 * search results instead of opening a guessed page. Being asked to pick is
 * better than being sent to another artist's release.
 */
export function showEntitySearch(query: string, filter: SearchFilterName): void {
  const value = query.trim()
  if (!value) return
  nav.go('search')
  searchState.setFilter(filter)
  searchState.setQuery(value)
}
