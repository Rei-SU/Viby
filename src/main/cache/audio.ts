import { join } from 'node:path'
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { JsonStore } from '../json-store'
import { isAudioExtension, safeAudioExtension, safeFileId } from '../safe-name'
import type { CacheStats, Track } from '@shared/types'

export type CachedTrackHit = {
  file: string
  ext: string
  track?: Track
  quality?: string
}

type CacheEntry = {
  ext: string
  bytes: number
  lastUsed: number
  /** Snapshot so a hit survives a lost or reset track store. */
  track?: Track
  /** `best` or `data-saver`; older entries have no tag and are treated as best. */
  quality?: string
}

type CacheIndex = {
  entries: Record<string, CacheEntry>
}

type PutExtras = {
  keepId?: string
  track?: Track
  quality?: string
}

function snapshotTrack(track: Track): Track {
  return {
    ...track,
    artistParts: track.artistParts?.map((part) => ({ ...part }))
  }
}

function validEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as CacheEntry
  const track = entry.track as Partial<Track> | undefined
  return (
    typeof entry.ext === 'string' &&
    isAudioExtension(entry.ext) &&
    Number.isFinite(entry.bytes) &&
    entry.bytes >= 0 &&
    Number.isFinite(entry.lastUsed) &&
    (track === undefined ||
      (Boolean(track) &&
        typeof track.id === 'string' &&
        track.id.length > 0 &&
        typeof track.title === 'string' &&
        typeof track.artist === 'string' &&
        Number.isFinite(track.durationSec))) &&
    (entry.quality === undefined || typeof entry.quality === 'string')
  )
}

/**
 * Bounded LRU audio cache (PLAN §6). The index is only a promise if it matches
 * the folder: a corrupt index, a failed unlink or an extension change must not
 * strand files that eviction can no longer see. `reconcile()` rebuilds that
 * truth once at startup; every write keeps it.
 */
export class AudioCache {
  private store: JsonStore<CacheIndex>

  constructor(
    private readonly dir: string,
    private readonly capBytes: () => number
  ) {
    mkdirSync(dir, { recursive: true })
    this.store = new JsonStore<CacheIndex>(join(dir, 'index.json'), { entries: {} })
    this.sanitizeIndex()
  }

  get path(): string {
    return this.dir
  }

  /** Absolute path if the track is cached and the file still exists. */
  lookup(trackId: string): string | null {
    return this.find(trackId)?.file ?? null
  }

  find(trackId: string): CachedTrackHit | null {
    const key = safeFileId(trackId)
    const entry = this.store.get().entries[key]
    if (!entry) return null
    const file = join(this.dir, `${key}.${entry.ext}`)
    let size: number
    try {
      size = statSync(file).size
    } catch {
      this.store.update((data) => {
        delete data.entries[key]
      })
      return null
    }
    // A truncated or replaced file is not the recording we cached. Treat it as
    // a miss and drop it so the next play fetches a usable copy.
    if (size !== entry.bytes) {
      this.unlink(`${key}.${entry.ext}`)
      this.store.update((data) => {
        delete data.entries[key]
      })
      return null
    }
    return { file, ext: entry.ext, track: entry.track, quality: entry.quality }
  }

  extOf(trackId: string): string | null {
    return this.store.get().entries[safeFileId(trackId)]?.ext ?? null
  }

  touch(trackId: string): void {
    const key = safeFileId(trackId)
    this.store.update((data) => {
      const entry = data.entries[key]
      if (entry) entry.lastUsed = Date.now()
    })
  }

  /**
   * Move a fully downloaded temp file into the cache. Space is reclaimed before
   * the rename so a nearly full cache cannot fail after the file moved.
   */
  put(trackId: string, tmpFile: string, ext: string, extras: PutExtras = {}): string {
    const key = safeFileId(trackId)
    const cleanExt = safeAudioExtension(ext)
    const dest = join(this.dir, `${key}.${cleanExt}`)
    const incoming = statSync(tmpFile).size

    const previous = this.store.get().entries[key]
    this.trim(this.capBytes() - incoming + (previous?.bytes ?? 0), extras.keepId)

    // A re-cache under a new container must not leave the old file behind.
    for (const name of this.files()) {
      if (!name.startsWith(`${key}.`)) continue
      if (name === `${key}.${cleanExt}`) continue
      this.unlink(name)
    }

    renameSync(tmpFile, dest)
    const bytes = statSync(dest).size
    this.store.update((data) => {
      data.entries[key] = {
        ext: cleanExt,
        bytes,
        lastUsed: Date.now(),
        ...(extras.track ? { track: snapshotTrack(extras.track) } : {}),
        ...(extras.quality ? { quality: extras.quality } : {})
      }
    })
    // Never evict the file that was just moved in: a single recording larger
    // than the whole cap would otherwise be deleted before it could play.
    this.trim(this.capBytes(), extras.keepId ?? key)
    return dest
  }

  /** Drop a cached copy, e.g. when the file turned out to be unusable. */
  remove(trackId: string): void {
    const key = safeFileId(trackId)
    const entry = this.store.get().entries[key]
    if (entry) this.unlink(`${key}.${entry.ext}`)
    this.store.update((data) => {
      delete data.entries[key]
    })
  }

  /** Remove entries cached under a quality we no longer want to serve. */
  invalidateQuality(quality: string, keepId?: string): void {
    const keep = keepId ? safeFileId(keepId) : ''
    const removed: string[] = []
    for (const [key, entry] of Object.entries(this.store.get().entries)) {
      if (entry.quality !== quality || key === keep) continue
      // A file held open (Windows, currently playing) stays in the index so disk
      // and index do not drift; the online hit check refuses it by quality.
      if (!this.unlink(`${key}.${entry.ext}`)) continue
      removed.push(key)
    }
    if (removed.length === 0) return
    this.store.update((data) => {
      for (const key of removed) delete data.entries[key]
    })
  }

  has(trackId: string): boolean {
    return this.lookup(trackId) !== null
  }

  bytes(): number {
    return Object.values(this.store.get().entries).reduce((sum, entry) => sum + entry.bytes, 0)
  }

  /**
   * Drop least-recently-used entries until we are back under the cap.
   * `keepId` may leave the cache slightly over cap while that track plays; it is
   * removed by the next eviction after playback moves on.
   */
  evict(keepId?: string): void {
    this.trim(this.capBytes(), keepId)
  }

  /**
   * Rebuild the index from the folder at startup. A cache index can be lost or
   * corrupted without losing the audio; adopt valid files, delete junk, keep
   * one extension per track and re-enforce the cap.
   */
  reconcile(): void {
    const index = this.store.get().entries
    const groups = new Map<string, Array<{ name: string; ext: string; bytes: number; mtime: number }>>()

    for (const name of this.files()) {
      if (name === 'index.json') continue
      const match = /^(.+)\.([a-z0-9]+)$/.exec(name)
      if (!match) {
        this.unlink(name)
        continue
      }
      const [, id, ext] = match
      if (safeFileId(id) !== id || !isAudioExtension(ext)) {
        this.unlink(name)
        continue
      }
      try {
        const info = statSync(join(this.dir, name))
        if (!info.isFile()) {
          this.unlink(name)
          continue
        }
        const group = groups.get(id) ?? []
        group.push({ name, ext, bytes: info.size, mtime: info.mtimeMs })
        groups.set(id, group)
      } catch {
        // Vanished while scanning; the next reconcile will miss it too.
      }
    }

    const entries: Record<string, CacheEntry> = {}
    for (const [id, files] of groups) {
      const prior = index[id]
      const chosen =
        (prior && files.find((file) => file.ext === prior.ext)) ??
        [...files].sort((a, b) => b.mtime - a.mtime)[0]
      for (const file of files) {
        if (file !== chosen) this.unlink(file.name)
      }
      entries[id] = {
        ext: chosen.ext,
        bytes: chosen.bytes,
        lastUsed: Math.max(prior?.lastUsed ?? 0, chosen.mtime),
        ...(prior?.track ? { track: prior.track } : {}),
        ...(prior?.quality ? { quality: prior.quality } : {})
      }
    }

    this.store.set({ entries })
    this.evict()
  }

  stats(): CacheStats {
    const entries = Object.keys(this.store.get().entries).length
    return { bytes: this.bytes(), capBytes: this.capBytes(), entries, dir: this.dir }
  }

  clear(keepId?: string): CacheStats {
    const key = keepId ? safeFileId(keepId) : null
    const keep = key ? this.store.get().entries[key] : undefined
    const keepName = key && keep ? `${key}.${keep.ext}` : null
    for (const name of this.files()) {
      if (name === 'index.json' || name === keepName) continue
      this.unlink(name)
    }
    this.store.set({ entries: key && keep ? { [key]: keep } : {} })
    return this.stats()
  }

  private trim(limit: number, keepId?: string): void {
    const keep = keepId ? safeFileId(keepId) : ''
    let total = this.bytes()
    if (total <= limit) return

    const ordered = Object.entries(this.store.get().entries)
      .filter(([id]) => id !== keep)
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
    const removed: string[] = []

    for (const [id, entry] of ordered) {
      if (total <= limit) break
      if (!this.unlink(`${id}.${entry.ext}`)) continue
      removed.push(id)
      total -= entry.bytes
    }

    if (removed.length > 0) {
      this.store.update((data) => {
        for (const id of removed) delete data.entries[id]
      })
    }
  }

  private sanitizeIndex(): void {
    const source = this.store.get().entries
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      this.store.set({ entries: {} })
      return
    }

    const entries: Record<string, CacheEntry> = {}
    let changed = false
    for (const [key, value] of Object.entries(source)) {
      if (safeFileId(key) !== key || !validEntry(value)) {
        changed = true
        continue
      }
      entries[key] = value
    }
    if (changed) this.store.set({ entries })
  }

  private files(): string[] {
    try {
      return readdirSync(this.dir)
    } catch {
      return []
    }
  }

  /** Remove one file; true when it is gone (including "was already gone"). */
  private unlink(name: string): boolean {
    try {
      unlinkSync(join(this.dir, name))
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }
}
