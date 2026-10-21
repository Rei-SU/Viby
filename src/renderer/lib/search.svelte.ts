import type { CatalogItem, SearchFilterName } from '@shared/types'
import { api } from './api'
import { downloads } from './downloads.svelte'
import { network } from './network.svelte'
import { trackToItem } from './track'

/**
 * Search state lives outside the component on purpose: opening an artist page
 * unmounts SearchView, and losing the query and results when you come back is
 * exactly the kind of thing that makes an app feel disposable.
 */
class SearchState {
  query = $state('')
  filter = $state<SearchFilterName>('all')
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

  /** Skip the typing debounce — used when Enter commits the search. */
  submit(filter?: SearchFilterName): void {
    if (filter) this.filter = filter
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.query.trim()) void this.load()
  }

  async load(): Promise<void> {
    const query = this.query.trim()
    if (!query) return

    const mine = ++this.seq
    this.loading = true

    // Offline search is a search over downloads, not a cached catalog. It still
    // finds songs by title, artist or album without touching the network.
    if (network.localFirst) {
      await downloads.init()
      if (mine !== this.seq) return
      const needle = query.toLowerCase()
      this.items = downloads.entries
        .filter((entry) => {
          const haystack = `${entry.track.title} ${entry.track.artist} ${entry.track.album ?? ''}`
          return haystack.toLowerCase().includes(needle)
        })
        .map((entry) => ({
          ...trackToItem(entry.track),
          thumbnail: entry.artUrl ?? entry.track.thumbnail
        }))
      this.error = null
      this.loading = false
      return
    }

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
