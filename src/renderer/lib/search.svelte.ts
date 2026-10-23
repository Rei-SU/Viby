import type { CatalogItem, SearchFilterName } from '@shared/types'
import { api } from './api'
import { network } from './network.svelte'

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
  /**
   * Which data source produced `items`. Search is online-only, so any rows
   * left over after the connection drops must not stay on screen.
   */
  source = $state<'online' | null>(null)

  private seq = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  /** Rows that belong to the connectivity mode the app is in right now. */
  get visibleItems(): CatalogItem[] {
    return !network.localFirst && this.source === 'online' ? this.items : []
  }

  setQuery(query: string): void {
    this.query = query
    if (this.timer) clearTimeout(this.timer)

    if (!query.trim() || network.localFirst) {
      this.clearResults()
      return
    }

    this.timer = setTimeout(() => void this.load(), 220)
  }

  setFilter(filter: SearchFilterName): void {
    if (this.filter === filter) return
    this.filter = filter
    if (network.localFirst) return
    // Drop the previous category's rows at once so a back-to-back switch
    // does not keep showing stale names while the new request is in flight.
    this.items = []
    this.loading = true
    if (this.query.trim()) void this.load()
  }

  /** Skip the typing debounce — used when Enter commits the search. */
  submit(filter?: SearchFilterName): void {
    if (filter) this.filter = filter
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!network.localFirst && this.query.trim()) void this.load()
  }

  /**
   * Connectivity changed. Search needs the catalog, so drop online rows at
   * once. If the connection came back, rerun the retained query.
   */
  refreshSource(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const query = this.query.trim()
    this.clearResults()
    if (network.localFirst || !query) return
    void this.load()
  }

  async load(): Promise<void> {
    const query = this.query.trim()
    if (!query) return

    if (network.localFirst) {
      this.clearResults()
      return
    }

    const mine = ++this.seq
    this.loading = true

    // Never keep rows from the other source on screen while this one answers.
    if (this.source !== 'online') this.items = []
    this.source = 'online'

    // The "All" view is built from the same per-category searches the titlebar
    // dropdown uses, so a song row on the page is identical to one in the
    // dropdown (same metadata, same ordering rules) — only the presentation
    // differs.
    if (this.filter === 'all') {
      const [songs, artists, albums, playlists] = await Promise.all([
        api.catalog.search(query, 'songs'),
        api.catalog.search(query, 'artists'),
        api.catalog.search(query, 'albums'),
        api.catalog.search(query, 'playlists')
      ])
      if (mine !== this.seq) return
      if (songs.ok || artists.ok || albums.ok || playlists.ok) {
        this.items = [
          ...(songs.ok ? songs.data : []),
          ...(artists.ok ? artists.data : []),
          ...(albums.ok ? albums.data : []),
          ...(playlists.ok ? playlists.data : [])
        ]
        this.error = null
      } else {
        this.items = []
        this.error = songs.error ?? artists.error ?? albums.error ?? playlists.error ?? null
      }
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

  private clearResults(): void {
    this.seq += 1
    this.items = []
    this.source = null
    this.error = null
    this.loading = false
  }
}

export const searchState = new SearchState()
