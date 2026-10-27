import type { BrowseResult, MoodCategory } from '@shared/types'
import { api } from './api'

const TTL_MS = 10 * 60 * 1000

/**
 * Mood/genre tiles and their pages. The tile list is tiny and the pages are
 * large (a couple of MB), so categories are fetched once per session and pages
 * are cached for ten minutes like any detail page.
 */
class Moods {
  categories = $state<MoodCategory[]>([])
  loading = $state(false)
  error = $state<string | null>(null)

  private attempted = false
  private pages = new Map<string, { data: BrowseResult; at: number }>()

  async load(force = false): Promise<void> {
    if (this.loading || (this.attempted && !force && this.categories.length > 0)) return
    this.loading = true
    this.error = null
    try {
      const res = await api.catalog.moods()
      if (res.ok) this.categories = res.data
      else this.error = res.error
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.attempted = true
      this.loading = false
    }
  }

  /** The title a card uses ("Energy") need not match YouTube's ("Energize"). */
  paramsFor(title: string): string | undefined {
    const wanted = title.trim().toLowerCase()
    return this.categories.find((entry) => entry.title.trim().toLowerCase() === wanted)?.params
  }

  cached(params: string): BrowseResult | null {
    const hit = this.pages.get(params)
    if (!hit) return null
    if (Date.now() - hit.at > TTL_MS) {
      this.pages.delete(params)
      return null
    }
    return hit.data
  }

  remember(params: string, data: BrowseResult): void {
    this.pages.set(params, { data, at: Date.now() })
    if (this.pages.size > 20) {
      const oldest = [...this.pages.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) this.pages.delete(oldest[0])
    }
  }
}

export const moods = new Moods()
