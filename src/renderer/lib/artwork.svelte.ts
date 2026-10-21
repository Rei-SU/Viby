import { api } from './api'

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * Library artwork needs to survive a dead connection. Main caches images by
 * URL; this store hands components the local `viby-media://` copy as soon as it
 * exists and keeps asking in the background for the rest.
 *
 * The original URL is returned until the cache has an answer, so online the
 * first paint is unchanged apart from a later (browser-cached) swap.
 */
class ArtworkStore {
  private local = $state<Record<string, string>>({})
  private known = new Set<string>()
  private pending = new Set<string>()
  private failed = new Set<string>()
  private queue: string[] = []
  private flushing = false

  /** Outer art is local immediately; saved-library art is warmed in the queue. */
  src(url: string | undefined): string | undefined {
    if (!url) return undefined
    if (!isRemote(url)) return url
    const cached = this.local[url]
    if (cached) return cached
    this.enqueue(url)
    return url
  }

  /**
   * Warm every image a surface is about to show. With `retry`, images that
   * failed while offline get another chance after the network comes back.
   */
  warm(urls: Array<string | undefined>, retry = false): void {
    for (const url of urls) {
      if (!url || !isRemote(url)) continue
      if (retry) this.failed.delete(url)
      this.enqueue(url)
    }
  }

  /** Re-queue images that previously failed, e.g. after a reconnect. */
  retry(): void {
    const retryable = [...this.failed]
    this.failed.clear()
    for (const url of retryable) this.enqueue(url)
  }

  private enqueue(url: string): void {
    if (this.known.has(url) || this.pending.has(url) || this.failed.has(url)) return
    this.pending.add(url)
    this.queue.push(url)
    void this.flush()
  }

  private async flush(): Promise<void> {
    if (this.flushing) return
    this.flushing = true
    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, 8)
        try {
          const resolved = await api.images.cache(batch)
          if (Object.keys(resolved).length > 0) {
            for (const [url, local] of Object.entries(resolved)) this.known.add(url)
            this.local = { ...this.local, ...resolved }
          }
        } catch {
          // Treat transport errors like an offline miss and retry later.
        }
        for (const url of batch) {
          this.pending.delete(url)
          if (!this.known.has(url)) this.failed.add(url)
        }
      }
    } finally {
      this.flushing = false
    }
  }
}

export const artwork = new ArtworkStore()
