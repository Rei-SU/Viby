import type {
  DownloadCollectionInput,
  DownloadJobState,
  DownloadJobView,
  DownloadProgress,
  DownloadsSnapshot,
  Track
} from '@shared/types'
import { api } from './api'
import { player } from './player.svelte'
import { plainTrack } from './track'

export type DownloadUiState = 'idle' | DownloadJobState | 'done'

export type CollectionCounts = {
  done: number
  total: number
  active: number
  paused: number
  failed: number
}

/**
 * Mirrors the main-process downloads index. The snapshot is the authority;
 * progress events only patch the in-flight rows so a 40MB song does not force a
 * full-library round trip four times a second.
 */
class DownloadsStore {
  snapshot = $state<DownloadsSnapshot | null>(null)
  jobs = $state<Record<string, DownloadJobView>>({})
  loading = $state(false)
  error = $state<string | null>(null)

  private wired = false
  private lastRevision = 0

  get entries() {
    return this.snapshot?.entries ?? []
  }

  get collections() {
    return this.snapshot?.collections ?? []
  }

  get stats() {
    return this.snapshot?.stats ?? null
  }

  async init(): Promise<void> {
    if (this.wired) return
    this.wired = true
    api.downloads.onChanged((snapshot) => this.apply(snapshot))
    api.downloads.onProgress((progress) => this.progress(progress))
    await this.reload()
  }

  async reload(): Promise<void> {
    this.loading = true
    try {
      this.apply(await api.downloads.snapshot())
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      this.loading = false
    }
  }

  private async mutate(action: () => Promise<DownloadsSnapshot>): Promise<void> {
    try {
      this.apply(await action())
      this.error = null
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      // The request may have partially applied. Re-read the authoritative index
      // instead of leaving the UI on an optimistic state.
      await this.reload()
    }
  }

  entryFor(trackId: string) {
    return this.entries.find((entry) => entry.track.id === trackId) ?? null
  }

  downloaded(trackId: string): boolean {
    return this.entries.some((entry) => entry.track.id === trackId)
  }

  jobFor(trackId: string): DownloadJobView | null {
    return this.jobs[trackId] ?? null
  }

  stateFor(trackId: string): DownloadUiState {
    const job = this.jobs[trackId]
    if (job) return job.state
    return this.downloaded(trackId) ? 'done' : 'idle'
  }

  /**
   * Coverage for a playlist/album, using what is actually on disk. Pending
   * states can be scoped to one collection so a paused playlist job does not
   * make an album header claim work it does not own.
   */
  countsFor(tracks: Track[], sourceKey?: string): CollectionCounts {
    let done = 0
    let active = 0
    let paused = 0
    let failed = 0
    for (const track of tracks) {
      if (this.downloaded(track.id)) done += 1
      const job = this.jobs[track.id]
      if (!job || (sourceKey && !job.sources.includes(sourceKey))) continue
      if (job.state === 'queued' || job.state === 'downloading') active += 1
      if (job.state === 'paused') paused += 1
      if (job.state === 'failed') failed += 1
    }
    return { done, total: tracks.length, active, paused, failed }
  }

  async addTrack(track: Track): Promise<void> {
    await this.mutate(() => api.downloads.addTrack(plainTrack(track)))
  }

  async addCollection(input: DownloadCollectionInput, tracks: Track[]): Promise<void> {
    await this.mutate(() => api.downloads.addCollection(input, tracks.map(plainTrack)))
  }

  async removeTrack(trackId: string): Promise<void> {
    this.pauseIfPlaying([trackId])
    await this.mutate(() => api.downloads.removeTrack(trackId))
  }

  async removeCollection(key: string): Promise<void> {
    const collection = this.collections.find((item) => item.key === key)
    if (collection) this.pauseIfPlaying(collection.trackIds)
    await this.mutate(() => api.downloads.removeCollection(key))
  }

  async pruneCollection(key: string, trackIds: string[]): Promise<void> {
    const collection = this.collections.find((item) => item.key === key)
    if (collection) {
      const keep = new Set(trackIds)
      this.pauseIfPlaying(collection.trackIds.filter((id) => !keep.has(id)))
    }
    await this.mutate(() => api.downloads.pruneCollection(key, trackIds))
  }

  async clear(): Promise<void> {
    this.pauseIfPlaying(this.entries.map((entry) => entry.track.id))
    await this.mutate(() => api.downloads.clear())
  }

  async retry(trackId: string): Promise<void> {
    await this.mutate(() => api.downloads.retry(trackId))
  }

  async cancel(trackId: string): Promise<void> {
    await this.mutate(() => api.downloads.cancel(trackId))
  }

  private apply(snapshot: DownloadsSnapshot): void {
    // A slow snapshot request can resolve after an onChanged event. Revisions
    // are assigned by main before it awaits stats, so lower means stale.
    if (snapshot.revision < this.lastRevision) return
    this.lastRevision = snapshot.revision
    this.snapshot = snapshot
    this.jobs = Object.fromEntries(snapshot.jobs.map((job) => [job.trackId, job]))
  }

  /**
   * Removing the file that is currently playing would tear playback out from
   * under the user (and fail on Windows, where the OS holds the handle). Pause
   * first; the file itself is then cleaned up by the store or next launch.
   */
  private pauseIfPlaying(ids: Iterable<string>): void {
    const current = player.current
    if (!current || !player.playing) return
    const set = new Set(ids)
    if (set.has(current.id) || (current.sourceId != null && set.has(current.sourceId))) {
      player.toggle()
    }
  }

  private progress(progress: DownloadProgress): void {
    const current = this.jobs[progress.trackId]
    if (!current) {
      // A job that started between snapshots: pull the authoritative row.
      void this.reload()
      return
    }
    this.jobs = {
      ...this.jobs,
      [progress.trackId]: { ...current, ...progress }
    }
  }

  get pendingCount(): number {
    return Object.keys(this.jobs).length
  }

  async cancelCollection(key: string): Promise<void> {
    await this.mutate(() => api.downloads.cancelCollection(key))
  }

  async pause(trackId: string): Promise<void> {
    await this.mutate(() => api.downloads.pause(trackId))
  }

  async resume(trackId: string): Promise<void> {
    await this.mutate(() => api.downloads.resume(trackId))
  }

  async pauseCollection(key: string): Promise<void> {
    await this.mutate(() => api.downloads.pauseCollection(key))
  }

  async resumeCollection(key: string): Promise<void> {
    await this.mutate(() => api.downloads.resumeCollection(key))
  }
}

export const downloads = new DownloadsStore()
