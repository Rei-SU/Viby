import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
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
  Lyrics,
  Quality,
  Track
} from '@shared/types'
import { JsonStore, recoveryMarkerFor } from '../json-store'
import { mediaUrlFor } from '../media'
import { safeFileId } from '../safe-name'

export type DownloadJob = {
  track: Track
  sources: string[]
  state: DownloadJobState
  quality: Quality
  attempts: number
  error?: string
  /** Last known total from yt-dlp, used for the free-space guard on retries. */
  estimateBytes?: number
  /** Explicit pause; startup and reconnects must not resume this job. */
  pausedByUser?: boolean
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
  private revision = 0
  /**
   * A corrupt index leaves us with no list of which files are referenced.
   * Sweeping would then delete every download, so pause destructive cleanup
   * until the user explicitly clears the library.
   */
  private recoveryNeeded: boolean

  constructor(private readonly root: string) {
    mkdirSync(this.audioDir, { recursive: true })
    mkdirSync(this.artDir, { recursive: true })
    mkdirSync(this.lyricsDir, { recursive: true })
    mkdirSync(this.tmpDir, { recursive: true })
    const indexFile = join(root, 'index.json')
    this.store = new JsonStore<DownloadData>(indexFile, {
      entries: {},
      collections: {},
      jobs: {}
    })
    this.recoveryNeeded =
      this.store.loadFailed || existsSync(recoveryMarkerFor(indexFile))

    const data = this.store.get()
    const invalidShape =
      !data.entries ||
      typeof data.entries !== 'object' ||
      Array.isArray(data.entries) ||
      !data.collections ||
      typeof data.collections !== 'object' ||
      Array.isArray(data.collections) ||
      !data.jobs ||
      typeof data.jobs !== 'object' ||
      Array.isArray(data.jobs)

    if (invalidShape) {
      // A parseable index with the wrong shape is still suspicious. Pause the
      // orphan sweep instead of treating every audio file as unreferenced and
      // deleting it. Reset only the in-memory copy; leave the file for review.
      this.recoveryNeeded = true
      try {
        writeFileSync(
          recoveryMarkerFor(indexFile),
          JSON.stringify({ at: Date.now(), file: indexFile })
        )
      } catch {
        // The in-memory flag still protects this run.
      }
      if (!data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) {
        data.entries = {}
      }
      if (
        !data.collections ||
        typeof data.collections !== 'object' ||
        Array.isArray(data.collections)
      ) {
        data.collections = {}
      }
      if (!data.jobs || typeof data.jobs !== 'object' || Array.isArray(data.jobs)) {
        data.jobs = {}
      }
    }

    if (!this.recoveryNeeded) this.heal()
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

  /** Lyrics saved with a download, so they keep working offline. */
  get lyricsDir(): string {
    return join(this.root, 'lyrics')
  }

  get tmpDir(): string {
    return join(this.root, 'tmp')
  }

  tmpDirFor(trackId: string): string {
    return join(this.tmpDir, this.safeId(trackId))
  }

  /** Video ids are already URL-safe, but never let an id escape the folder. */
  safeId(trackId: string): string {
    return safeFileId(trackId)
  }

  lyricsPath(trackId: string): string {
    return join(this.lyricsDir, `${this.safeId(trackId)}.json`)
  }

  /** The lyrics pinned to a download, or null when none were saved. */
  lyrics(trackId: string): Lyrics | null {
    try {
      const parsed = JSON.parse(readFileSync(this.lyricsPath(trackId), 'utf8')) as Lyrics
      if (!parsed || typeof parsed !== 'object' || typeof parsed.kind !== 'string') return null
      return parsed
    } catch {
      return null
    }
  }

  putLyrics(trackId: string, lyrics: Lyrics): void {
    if (!this.store.get().entries[trackId]) return
    try {
      mkdirSync(this.lyricsDir, { recursive: true })
      const file = this.lyricsPath(trackId)
      // A unique temp name keeps the download-time and playback-time lookups
      // from colliding if both finish at once.
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      writeFileSync(tmp, JSON.stringify(lyrics))
      renameSync(tmp, file)
    } catch {
      // Lyrics are a bonus; a failed write must never fail a download or lookup.
    }
  }

  /** Drop the lyrics pinned to a download (e.g. after a credit repair). */
  removeLyrics(trackId: string): void {
    rmSync(this.lyricsPath(trackId), { force: true })
  }

  lookup(trackId: string): string | null {
    const entry = this.store.get().entries[trackId]
    if (!entry) return null
    const file = join(this.audioDir, `${this.safeId(trackId)}.${entry.ext}`)
    if (!existsSync(file)) {
      // Drop the stale entry but keep it in any collection's trackIds: the
      // collection can then show incomplete coverage and be repaired on demand.
      this.removeMissingEntry(trackId, entry)
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

  /**
   * Fill in metadata an older build could not know when the download was
   * queued (an album opened outside the artist page stored no artist). Only the
   * credits are patched; the file, quality and source list stay untouched.
   */
  patchTrack(trackId: string, patch: Partial<Pick<Track, 'artist' | 'artistId' | 'artistParts' | 'album' | 'albumId' | 'thumbnail'>>): boolean {
    let changed = false
    this.store.update((data) => {
      const entry = data.entries[trackId]
      if (entry) {
        entry.track = { ...entry.track, ...patch }
        changed = true
      }
      const job = data.jobs[trackId]
      if (job) {
        job.track = { ...job.track, ...patch }
        changed = true
      }
    })
    return changed
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
    // Assign the revision before awaiting stats: if two snapshots resolve out of
    // order, the renderer can discard the older one instead of flickering back.
    const revision = ++this.revision
    return {
      revision,
      entries: this.entries(),
      collections: this.collections(),
      jobs,
      stats: await this.stats()
    }
  }

  bytes(): number {
    return Object.values(this.store.get().entries).reduce((sum, entry) => sum + entry.bytes, 0)
  }

  async freeBytes(): Promise<number | null> {
    try {
      const fs = await statfs(this.root)
      return Number(fs.bavail) * Number(fs.bsize)
    } catch {
      // "Unknown" is not "full". Returning 0 turned a statfs failure into a
      // permanent "not enough disk space" failure for every download.
      return null
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
    // The renderer's badge can be stale if a file was removed outside Viby.
    // Drop those entries first so clicking Download starts a real job instead of
    // only adding a source to a download that no longer exists.
    for (const { track } of items) {
      const entry = this.store.get().entries[track.id]
      if (!entry) continue
      const file = join(this.audioDir, `${this.safeId(track.id)}.${entry.ext}`)
      if (!existsSync(file)) this.removeMissingEntry(track.id, entry)
    }

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
  pruneCollection(
    key: string,
    trackIds: string[],
    keepFile?: (trackId: string) => boolean
  ): string[] {
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
          this.unlinkEntry(id, entry, keepFile?.(id) ?? false)
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

    // Rename over the old file atomically. Node maps this to a replace-existing
    // move on Windows too; deleting the destination first could lose the only
    // playable copy if the rename then failed (locked file, full disk).
    renameSync(tmpFile, dest)
    if (previous && previous.ext !== ext) {
      try {
        unlinkSync(join(this.audioDir, `${id}.${previous.ext}`))
      } catch {
        // Orphaned old extension; startup healing removes it.
      }
    }
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

  removeTrack(trackId: string, keepFile = false): void {
    this.store.update((data) => {
      const entry = data.entries[trackId]
      if (entry) this.unlinkEntry(trackId, entry, keepFile)
      delete data.entries[trackId]
      delete data.jobs[trackId]
      // A row-level removal means the track is no longer part of any downloaded
      // album or playlist. Leaving the id behind made collections show ghost
      // tracks that could never be played again.
      for (const [key, collection] of Object.entries(data.collections)) {
        collection.trackIds = collection.trackIds.filter((id) => id !== trackId)
        if (collection.trackIds.length === 0) delete data.collections[key]
      }
    })
    rmSync(this.tmpDirFor(trackId), { recursive: true, force: true })
    this.sweepArt()
    this.sweepLyrics()
  }

  /** Remove a collection and every reference it owned. Returns affected jobs. */
  removeCollection(key: string, keepFile?: (trackId: string) => boolean): string[] {
    const affected: string[] = []
    this.store.update((data) => {
      delete data.collections[key]

      for (const [id, entry] of Object.entries(data.entries)) {
        if (!entry.sources.includes(key)) continue
        entry.sources = entry.sources.filter((source) => source !== key)
        if (entry.sources.length === 0) {
          this.unlinkEntry(id, entry, keepFile?.(id) ?? false)
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
    this.sweepLyrics()
    return affected
  }

  /**
   * Remove every download. `keepTrackId` protects the file currently loaded in
   * the player; deleting it under an open media element breaks seeking and can
   * fail outright on Windows. The orphan is swept on the next launch.
   */
  clear(keepTrackId?: string): void {
    // An explicit clear is the user's acknowledgement that the preserved
    // recovery files can go away.
    this.recoveryNeeded = false
    rmSync(recoveryMarkerFor(join(this.root, 'index.json')), { force: true })
    const keepEntry = keepTrackId ? this.store.get().entries[keepTrackId] : undefined
    const keepName = keepEntry
      ? `${this.safeId(keepTrackId as string)}.${keepEntry.ext}`
      : null

    this.store.update((data) => {
      data.entries = {}
      data.collections = {}
      data.jobs = {}
    })

    for (const name of this.audioFiles()) {
      if (name === keepName) continue
      try {
        unlinkSync(join(this.audioDir, name))
      } catch {
        // Held by another process; the next launch sweeps it.
      }
    }

    rmSync(this.artDir, { recursive: true, force: true })
    rmSync(this.lyricsDir, { recursive: true, force: true })
    rmSync(this.tmpDir, { recursive: true, force: true })
    mkdirSync(this.audioDir, { recursive: true })
    mkdirSync(this.artDir, { recursive: true })
    mkdirSync(this.lyricsDir, { recursive: true })
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
    if (this.recoveryNeeded) return
    this.store.update((data) => {
      for (const [id, entry] of Object.entries(data.entries)) {
        const file = join(this.audioDir, `${this.safeId(id)}.${entry.ext}`)
        if (!existsSync(file)) delete data.entries[id]
      }

      // Album tracks often arrive without their own thumbnail. Once the
      // collection cover is on disk, make it the entry's cover too, so the
      // artwork survives for downloads made before this fallback existed.
      //
      // A stale index can point at art that was removed outside Viby (or was
      // never copied from another install). Drop those references before
      // handing them to the renderer, where a dead `viby-media://` URL is just
      // a broken image.
      const collections = Object.values(data.collections)
      for (const collection of collections) {
        if (collection.art && !existsSync(join(this.root, collection.art))) {
          delete collection.art
        }
      }
      for (const [id, entry] of Object.entries(data.entries)) {
        if (entry.art && existsSync(join(this.root, entry.art))) continue
        const owner = collections.find(
          (collection) => collection.art && collection.trackIds.includes(id)
        )
        if (owner?.art) entry.art = owner.art
        else delete entry.art
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
    this.sweepLyrics()
  }

  /**
   * Art is content-addressed, so several entries can share one cover. Delete any
   * file nothing points at any more. Runs after removals and on startup.
   */
  private sweepArt(): void {
    if (this.recoveryNeeded) return
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

  /** Lyrics belong to their entry; delete files whose entry is gone. */
  private sweepLyrics(): void {
    if (this.recoveryNeeded) return
    const wanted = new Set(Object.keys(this.store.get().entries).map((id) => `${this.safeId(id)}.json`))
    for (const name of this.lyricsFiles()) {
      if (wanted.has(name)) continue
      try {
        unlinkSync(join(this.lyricsDir, name))
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

  private lyricsFiles(): string[] {
    try {
      return readdirSync(this.lyricsDir)
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

  /** Drop an entry whose file vanished, without rewriting collection membership. */
  private removeMissingEntry(trackId: string, entry: DownloadEntry): void {
    this.unlinkEntry(trackId, entry)
    this.store.update((data) => {
      delete data.entries[trackId]
      delete data.jobs[trackId]
    })
    rmSync(this.tmpDirFor(trackId), { recursive: true, force: true })
    this.sweepArt()
    this.sweepLyrics()
  }

  private unlinkEntry(trackId: string, entry: DownloadEntry, keepFile = false): void {
    if (!keepFile) {
      try {
        unlinkSync(join(this.audioDir, `${this.safeId(trackId)}.${entry.ext}`))
      } catch {
        // Already gone; the index entry is the part that matters.
      }
    }
    rmSync(this.lyricsPath(trackId), { force: true })
  }

  /** Art that still exists on disk, as a path relative to the downloads root. */
  private existingArt(art: string | undefined): string | undefined {
    return art && existsSync(join(this.root, art)) ? art : undefined
  }

  /** The entry's own cover, or the cover of a downloaded collection it belongs to. */
  private artForEntry(entry: DownloadEntry): string | undefined {
    const own = this.existingArt(entry.art)
    if (own) return own
    for (const collection of Object.values(this.store.get().collections)) {
      if (!collection.trackIds.includes(entry.track.id)) continue
      const art = this.existingArt(collection.art)
      if (art) return art
    }
    return undefined
  }

  private decorateEntry(entry: DownloadEntry): DownloadEntry {
    const art = this.artForEntry(entry)
    return {
      ...entry,
      track: { ...entry.track },
      sources: [...entry.sources],
      artUrl: art ? mediaUrlFor(join(this.root, art)) : undefined
    }
  }

  private decorateCollection(collection: DownloadCollection): DownloadCollection {
    const art = this.existingArt(collection.art)
    return {
      ...collection,
      trackIds: [...collection.trackIds],
      artUrl: art ? mediaUrlFor(join(this.root, art)) : undefined
    }
  }

  /**
   * Stop pending work owned by one collection without touching completed files.
   * A job shared with another collection stays alive; the collection record is
   * dropped only when nothing downloaded and nothing queued still references it.
   */
  cancelJobsForSource(key: string): string[] {
    const affected: string[] = []
    this.store.update((data) => {
      for (const [id, job] of Object.entries(data.jobs)) {
        if (!job.sources.includes(key)) continue
        job.sources = job.sources.filter((source) => source !== key)
        if (job.sources.length > 0) continue
        delete data.jobs[id]
        affected.push(id)
      }

      const stillReferenced =
        Object.values(data.entries).some((entry) => entry.sources.includes(key)) ||
        Object.values(data.jobs).some((job) => job.sources.includes(key))
      if (!stillReferenced) delete data.collections[key]
    })
    return affected
  }

  /** Pause/resume a job, recording whether the user asked for it. */
  setJobPause(trackId: string, paused: boolean, byUser: boolean): void {
    this.store.update((data) => {
      const job = data.jobs[trackId]
      if (!job) return
      job.state = paused ? 'paused' : 'queued'
      job.pausedByUser = byUser
    })
  }
}
