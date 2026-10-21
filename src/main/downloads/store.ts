import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { statfs } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type {
  DownloadCollection,
  DownloadCollectionInput,
  DownloadEntry,
  DownloadJobState,
  DownloadJobView,
  DownloadStats,
  DownloadsSnapshot,
  Quality,
  Track
} from '@shared/types'
import { JsonStore } from '../json-store'
import { mediaUrlFor } from '../media'

export type DownloadJob = {
  track: Track
  sources: string[]
  state: DownloadJobState
  quality: Quality
  attempts: number
  error?: string
  /** Last known total from yt-dlp, used for the free-space guard on retries. */
  estimateBytes?: number
}

type DownloadData = {
  entries: Record<string, DownloadEntry>
  collections: Record<string, DownloadCollection>
  jobs: Record<string, DownloadJob>
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

/**
 * The downloads index (PLAN §17.5). Entries are the truth for playback: a file
 * without an entry is ignored, and an entry without a file is healed away.
 */
export class DownloadsStore {
  private store: JsonStore<DownloadData>

  constructor(private readonly root: string) {
    mkdirSync(this.audioDir, { recursive: true })
    mkdirSync(this.artDir, { recursive: true })
    mkdirSync(this.tmpDir, { recursive: true })
    this.store = new JsonStore<DownloadData>(join(root, 'index.json'), {
      entries: {},
      collections: {},
      jobs: {}
    })
    this.heal()
  }

  get dir(): string {
    return this.root
  }

  get audioDir(): string {
    return join(this.root, 'audio')
  }

  get artDir(): string {
    return join(this.root, 'art')
  }

  get tmpDir(): string {
    return join(this.root, 'tmp')
  }

  tmpDirFor(trackId: string): string {
    return join(this.tmpDir, this.safeId(trackId))
  }

  /** Video ids are already URL-safe, but never let an id escape the folder. */
  safeId(trackId: string): string {
    return trackId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96)
  }

  lookup(trackId: string): string | null {
    const entry = this.store.get().entries[trackId]
    if (!entry) return null
    const file = join(this.audioDir, `${this.safeId(trackId)}.${entry.ext}`)
    if (!existsSync(file)) {
      this.removeTrack(trackId)
      return null
    }
    return file
  }

  extOf(trackId: string): string | null {
    return this.store.get().entries[trackId]?.ext ?? null
  }

  entry(trackId: string): DownloadEntry | null {
    const entry = this.store.get().entries[trackId]
    return entry ? this.decorateEntry(entry) : null
  }

  has(trackId: string): boolean {
    return this.lookup(trackId) !== null
  }

  entries(): DownloadEntry[] {
    return Object.values(this.store.get().entries)
      .map((entry) => this.decorateEntry(entry))
      .sort((a, b) => b.downloadedAt - a.downloadedAt)
  }

  collections(): DownloadCollection[] {
    return Object.values(this.store.get().collections)
      .map((collection) => this.decorateCollection(collection))
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  collection(key: string): DownloadCollection | null {
    const collection = this.store.get().collections[key]
    return collection ? this.decorateCollection(collection) : null
  }

  job(trackId: string): DownloadJob | null {
    const job = this.store.get().jobs[trackId]
    return job ? { ...job, track: { ...job.track }, sources: [...job.sources] } : null
  }

  allJobs(): Array<{ id: string; job: DownloadJob }> {
    return Object.entries(this.store.get().jobs).map(([id, job]) => ({
      id,
      job: { ...job, track: { ...job.track }, sources: [...job.sources] }
    }))
  }

  jobViews(progress: Map<string, Partial<DownloadJobView>> = new Map()): DownloadJobView[] {
    return this.allJobs().map(({ id, job }) => ({
      trackId: id,
      track: job.track,
      sources: job.sources,
      state: job.state,
      quality: job.quality,
      attempts: job.attempts,
      error: job.error,
      ...progress.get(id)
    }))
  }

  async snapshot(jobs: DownloadJobView[]): Promise<DownloadsSnapshot> {
    return {
      entries: this.entries(),
      collections: this.collections(),
      jobs,
      stats: await this.stats()
    }
  }

  bytes(): number {
    return Object.values(this.store.get().entries).reduce((sum, entry) => sum + entry.bytes, 0)
  }

  async freeBytes(): Promise<number> {
    try {
      const fs = await statfs(this.root)
      return Number(fs.bavail) * Number(fs.bsize)
    } catch {
      return 0
    }
  }

  async stats(): Promise<DownloadStats> {
    return {
      bytes: this.bytes(),
      entries: Object.keys(this.store.get().entries).length,
      freeBytes: await this.freeBytes(),
      dir: this.root
    }
  }

  /** Add a source to an existing download, or queue every track that is missing. */
  enqueue(items: Array<{ track: Track; source: string }>, quality: Quality): string[] {
    const added: string[] = []
    this.store.update((data) => {
      for (const { track, source } of items) {
        if (!track?.id) continue

        const entry = data.entries[track.id]
        if (entry) {
          entry.sources = unique([...entry.sources, source])
          continue
        }

        const existing = data.jobs[track.id]
        if (existing) {
          existing.sources = unique([...existing.sources, source])
          continue
        }

        data.jobs[track.id] = {
          track: { ...track },
          sources: [source],
          state: 'queued',
          quality,
          attempts: 0
        }
        added.push(track.id)
      }
    })
    return added
  }

  addCollection(input: DownloadCollectionInput): void {
    this.store.update((data) => {
      const previous = data.collections[input.key]
      data.collections[input.key] = {
        key: input.key,
        kind: input.kind,
        title: input.title,
        thumbnail: input.thumbnail,
        art: previous?.art,
        trackIds: unique(input.trackIds),
        addedAt: previous?.addedAt ?? Date.now()
      }
    })
  }

  /** Playlist gained tracks: keep the snapshot current so coverage is honest. */
  syncCollection(key: string, trackIds: string[]): void {
    this.store.update((data) => {
      const collection = data.collections[key]
      if (collection) collection.trackIds = unique(trackIds)
    })
  }

  /** Playlist lost tracks: drop the reference and any file nobody else needs. */
  pruneCollection(key: string, trackIds: string[]): string[] {
    const keep = new Set(trackIds)
    const affected: string[] = []
    this.store.update((data) => {
      const collection = data.collections[key]
      if (collection) collection.trackIds = unique(trackIds)
      if (trackIds.length === 0) {
        delete data.collections[key]
      }

      for (const [id, entry] of Object.entries(data.entries)) {
        if (!entry.sources.includes(key) || keep.has(id)) continue
        entry.sources = entry.sources.filter((source) => source !== key)
        if (entry.sources.length === 0) {
          this.unlinkEntry(id, entry)
          delete data.entries[id]
        }
      }

      for (const [id, job] of Object.entries(data.jobs)) {
        if (!job.sources.includes(key) || keep.has(id)) continue
        job.sources = job.sources.filter((source) => source !== key)
        if (job.sources.length === 0) {
          delete data.jobs[id]
          affected.push(id)
        }
      }
    })
    this.sweepArt()
    return affected
  }

  setCollectionArt(key: string, art: string): void {
    this.store.update((data) => {
      const collection = data.collections[key]
      if (collection) collection.art = art
    })
  }

  setJobState(
    trackId: string,
    state: DownloadJobState,
    patch: { error?: string; attempts?: number } = {}
  ): void {
    this.store.update((data) => {
      const job = data.jobs[trackId]
      if (!job) return
      job.state = state
      if (patch.error !== undefined) job.error = patch.error
      if (patch.attempts !== undefined) job.attempts = patch.attempts
    })
  }

  /** Remember the reported size so the next attempt can guard disk space. */
  setJobEstimate(trackId: string, bytes: number): void {
    this.store.update((data) => {
      const job = data.jobs[trackId]
      if (job) job.estimateBytes = bytes
    })
  }

  deleteJob(trackId: string): void {
    this.store.update((data) => {
      delete data.jobs[trackId]
    })
  }

  /** Finish a download: move the temp file in, snapshot the track, clear the job. */
  put(
    track: Track,
    tmpFile: string,
    ext: string,
    sources: string[],
    quality: Quality,
    art?: string
  ): DownloadEntry {
    const id = this.safeId(track.id)
    const dest = join(this.audioDir, `${id}.${ext}`)
    const previous = this.store.get().entries[track.id]

    if (previous && previous.ext !== ext) {
      try {
        unlinkSync(join(this.audioDir, `${id}.${previous.ext}`))
      } catch {
        // Already gone.
      }
    }
    if (existsSync(dest)) {
      try {
        unlinkSync(dest)
      } catch {
        // Windows can briefly hold a file; rename below will surface the issue.
      }
    }

    renameSync(tmpFile, dest)
    const bytes = statSync(dest).size
    const duration = track.durationSec ?? 0
    const entry: DownloadEntry = {
      track: { ...track },
      ext,
      bytes,
      bitrateKbps: duration > 0 ? Math.round((bytes * 8) / duration / 1000) : undefined,
      downloadedAt: Date.now(),
      quality,
      art: art ?? previous?.art,
      sources: unique([...(previous?.sources ?? []), ...sources])
    }

    this.store.update((data) => {
      data.entries[track.id] = entry
      delete data.jobs[track.id]
    })
    rmSync(this.tmpDirFor(track.id), { recursive: true, force: true })
    return this.decorateEntry(entry)
  }

  removeSource(trackId: string, source: string): void {
    this.store.update((data) => {
      const entry = data.entries[trackId]
      if (!entry) return
      entry.sources = entry.sources.filter((value) => value !== source)
      if (entry.sources.length === 0) {
        this.unlinkEntry(trackId, entry)
        delete data.entries[trackId]
      }
    })
    this.sweepArt()
  }

  removeTrack(trackId: string): void {
    this.store.update((data) => {
      const entry = data.entries[trackId]
      if (entry) this.unlinkEntry(trackId, entry)
      delete data.entries[trackId]
      delete data.jobs[trackId]
    })
    rmSync(this.tmpDirFor(trackId), { recursive: true, force: true })
    this.sweepArt()
  }

  /** Remove a collection and every reference it owned. Returns affected jobs. */
  removeCollection(key: string): string[] {
    const affected: string[] = []
    this.store.update((data) => {
      delete data.collections[key]

      for (const [id, entry] of Object.entries(data.entries)) {
        if (!entry.sources.includes(key)) continue
        entry.sources = entry.sources.filter((source) => source !== key)
        if (entry.sources.length === 0) {
          this.unlinkEntry(id, entry)
          delete data.entries[id]
        }
      }

      for (const [id, job] of Object.entries(data.jobs)) {
        if (!job.sources.includes(key)) continue
        job.sources = job.sources.filter((source) => source !== key)
        if (job.sources.length === 0) {
          delete data.jobs[id]
          affected.push(id)
        }
      }
    })
    this.sweepArt()
    return affected
  }

  clear(): void {
    this.store.update((data) => {
      data.entries = {}
      data.collections = {}
      data.jobs = {}
    })
    rmSync(this.audioDir, { recursive: true, force: true })
    rmSync(this.artDir, { recursive: true, force: true })
    rmSync(this.tmpDir, { recursive: true, force: true })
    mkdirSync(this.audioDir, { recursive: true })
    mkdirSync(this.artDir, { recursive: true })
    mkdirSync(this.tmpDir, { recursive: true })
  }

  /**
   * Art files are content-addressed, so two tracks sharing a cover share a file.
   * Returns the relative path persisted in the index.
   */
  artNameFor(url: string, ext: string): string {
    return join('art', `${createHash('sha1').update(url).digest('hex')}.${ext}`)
  }

  private heal(): void {
    this.store.update((data) => {
      for (const [id, entry] of Object.entries(data.entries)) {
        const file = join(this.audioDir, `${this.safeId(id)}.${entry.ext}`)
        if (!existsSync(file)) delete data.entries[id]
      }

      for (const [id, job] of Object.entries(data.jobs)) {
        if (data.entries[id]) {
          delete data.jobs[id]
          continue
        }
        // A download interrupted by a quit resumes when the app comes back.
        if (job.state === 'downloading') job.state = 'paused'
      }
    })

    // Deferred deletion: Windows can hold a downloaded file open while it plays,
    // so a removal there may have left the audio file behind. A file with no
    // index entry is exactly that leftover (or a crash between rename and write).
    const referenced = new Set(
      Object.entries(this.store.get().entries).map(
        ([id, entry]) => `${this.safeId(id)}.${entry.ext}`
      )
    )
    for (const name of this.audioFiles()) {
      if (referenced.has(name)) continue
      try {
        unlinkSync(join(this.audioDir, name))
      } catch {
        // Still held; the next launch tries again.
      }
    }

    // Partial files are resumable only while their job exists.
    const wanted = new Set(Object.keys(this.store.get().jobs).map((id) => this.safeId(id)))
    for (const name of this.tmpDirs()) {
      if (wanted.has(name)) continue
      rmSync(join(this.tmpDir, name), { recursive: true, force: true })
    }

    this.sweepArt()
  }

  /**
   * Art is content-addressed, so several entries can share one cover. Delete any
   * file nothing points at any more. Runs after removals and on startup.
   */
  private sweepArt(): void {
    const refs = new Set<string>()
    for (const entry of Object.values(this.store.get().entries)) {
      if (entry.art) refs.add(basename(entry.art))
    }
    for (const collection of Object.values(this.store.get().collections)) {
      if (collection.art) refs.add(basename(collection.art))
    }
    for (const name of this.artFiles()) {
      if (refs.has(name)) continue
      try {
        unlinkSync(join(this.artDir, name))
      } catch {
        // Still held; the next launch tries again.
      }
    }
  }

  private audioFiles(): string[] {
    try {
      return readdirSync(this.audioDir)
    } catch {
      return []
    }
  }

  private artFiles(): string[] {
    try {
      return readdirSync(this.artDir)
    } catch {
      return []
    }
  }

  private tmpDirs(): string[] {
    try {
      return readdirSync(this.tmpDir)
    } catch {
      return []
    }
  }

  private unlinkEntry(trackId: string, entry: DownloadEntry): void {
    try {
      unlinkSync(join(this.audioDir, `${this.safeId(trackId)}.${entry.ext}`))
    } catch {
      // Already gone; the index entry is the part that matters.
    }
  }

  private decorateEntry(entry: DownloadEntry): DownloadEntry {
    return {
      ...entry,
      track: { ...entry.track },
      sources: [...entry.sources],
      artUrl: entry.art ? mediaUrlFor(join(this.root, entry.art)) : undefined
    }
  }

  private decorateCollection(collection: DownloadCollection): DownloadCollection {
    return {
      ...collection,
      trackIds: [...collection.trackIds],
      artUrl: collection.art ? mediaUrlFor(join(this.root, collection.art)) : undefined
    }
  }
}
