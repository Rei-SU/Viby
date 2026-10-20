import type { CatalogItem, SearchFilterName } from '@shared/types'
import { api } from './api'

/**
 * Search state lives outside the component on purpose: opening an artist page
 * unmounts SearchView, and losing the query and results when you come back is
 * exactly the kind of thing that makes an app feel disposable.
 */
class SearchState {
  query = $state('')
  filter = $state<SearchFilterName>('songs')
  items = $state<CatalogItem[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  setQuery(query: string): void {
    this.query = query
    if (this.timer) clearTimeout(this.timer)

    if (!query.trim()) {
      this.seq += 1
      this.items = []
      this.error = null
      this.loading = false
      return
    }

    this.timer = setTimeout(() => void this.load(), 220)
  }

  setFilter(filter: SearchFilterName): void {
    if (this.filter === filter) return
    this.filter = filter
    if (this.query.trim()) void this.load()
  }

  async load(): Promise<void> {
    const query = this.query.trim()
    if (!query) return

    const mine = ++this.seq
    this.loading = true
    const res = await api.catalog.search(query, this.filter)
    // A newer query already superseded this one.
    if (mine !== this.seq) return

    if (res.ok) {
      this.items = res.data
      this.error = null
    } else {
      this.items = []
      this.error = res.error
    }
    this.loading = false
  }
}

export const searchState = new SearchState()
