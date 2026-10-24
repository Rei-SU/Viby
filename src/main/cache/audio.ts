import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { JsonStore } from '../json-store'
import type { CacheStats } from '@shared/types'

type CacheEntry = {
  ext: string
  bytes: number
  lastUsed: number
}

type CacheIndex = {
  entries: Record<string, CacheEntry>
}

/**
 * Bounded LRU audio cache (PLAN §6). Eviction is the difference between a cache
 * that stays useful and one that quietly eats the user's disk.
 */
export class AudioCache {
  private store: JsonStore<CacheIndex>

  constructor(
    private readonly dir: string,
    private readonly capBytes: () => number
  ) {
    mkdirSync(dir, { recursive: true })
    this.store = new JsonStore<CacheIndex>(join(dir, 'index.json'), { entries: {} })
  }

  get path(): string {
    return this.dir
  }

  /** Absolute path if the track is cached and the file still exists on disk. */
  lookup(trackId: string): string | null {
    const entry = this.store.get().entries[trackId]
    if (!entry) return null
    const file = join(this.dir, `${trackId}.${entry.ext}`)
    if (!existsSync(file)) {
      this.store.update((d) => {
        delete d.entries[trackId]
      })
      return null
    }
    return file
  }

  extOf(trackId: string): string | null {
    return this.store.get().entries[trackId]?.ext ?? null
  }

  touch(trackId: string): void {
    this.store.update((d) => {
      const entry = d.entries[trackId]
      if (entry) entry.lastUsed = Date.now()
    })
  }

  /**
   * Move a fully downloaded temp file into the cache and evict if over cap.
   * `keepId` is the file currently playing: eviction must never pull it out
   * from under the media element.
   */
  put(trackId: string, tmpFile: string, ext: string, keepId?: string): string {
    const dest = join(this.dir, `${trackId}.${ext}`)
    // Rename replaces the destination atomically; unlinking first created a
    // window where a failed rename left the track with no cached file.
    renameSync(tmpFile, dest)
    const bytes = statSync(dest).size
    this.store.update((d) => {
      d.entries[trackId] = { ext, bytes, lastUsed: Date.now() }
    })
    this.evict(keepId)
    return dest
  }

  /** Drop a cached copy, e.g. when the file turned out to be unusable. */
  remove(trackId: string): void {
    const entry = this.store.get().entries[trackId]
    if (entry) {
      try {
        unlinkSync(join(this.dir, `${trackId}.${entry.ext}`))
      } catch {
        // Already gone.
      }
    }
    this.store.update((d) => {
      delete d.entries[trackId]
    })
  }

  has(trackId: string): boolean {
    return this.lookup(trackId) !== null
  }

  bytes(): number {
    return Object.values(this.store.get().entries).reduce((sum, e) => sum + e.bytes, 0)
  }

  /**
   * Drop least-recently-used entries until we are back under the cap.
   * `keepId` may leave the cache slightly over cap while that track plays; it is
   * removed by the next eviction after playback moves on.
   */
  evict(keepId?: string): void {
    const cap = this.capBytes()
    let total = this.bytes()
    if (total <= cap) return

    const ordered = Object.entries(this.store.get().entries)
      .filter(([id]) => id !== keepId)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)

    for (const [id, entry] of ordered) {
      if (total <= cap) break
      try {
        unlinkSync(join(this.dir, `${id}.${entry.ext}`))
      } catch {
        // Already gone; the index entry just needs removing.
      }
      this.store.update((d) => {
        delete d.entries[id]
      })
      total -= entry.bytes
    }
  }

  stats(): CacheStats {
    const entries = Object.keys(this.store.get().entries).length
    return { bytes: this.bytes(), capBytes: this.capBytes(), entries, dir: this.dir }
  }

  /**
   * Remove every cached file. `keepId` protects the file currently playing.
   * A per-file unlink is deliberate: deleting the whole directory throws on
   * Windows when Chromium holds the open file, so the handler used to fail and
   * leave the cache untouched.
   */
  clear(keepId?: string): CacheStats {
    const keep = keepId ? this.store.get().entries[keepId] : undefined
    const keepName = keepId && keep ? `${keepId}.${keep.ext}` : null
    for (const name of this.files()) {
      if (name === 'index.json' || name === keepName) continue
      try {
        unlinkSync(join(this.dir, name))
      } catch {
        // Held or already gone; the index drop below still frees the entry.
      }
    }
    this.store.update((d) => {
      d.entries = keepId && keep ? { [keepId]: keep } : {}
    })
    return this.stats()
  }

  private files(): string[] {
    try {
      return readdirSync(this.dir)
    } catch {
      return []
    }
  }
}
