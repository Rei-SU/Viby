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

export type DownloadUiState = 'idle' | DownloadJobState | 'done'

export type CollectionCounts = {
  done: number
  total: number
  active: number
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

  private wired = false

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
    } finally {
      this.loading = false
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

  /** Coverage for a playlist/album, using what is actually on disk. */
  countsFor(tracks: Track[]): CollectionCounts {
    let done = 0
    let active = 0
    let failed = 0
    for (const track of tracks) {
      if (this.downloaded(track.id)) done += 1
      const job = this.jobs[track.id]
      if (job && (job.state === 'queued' || job.state === 'downloading')) active += 1
      if (job?.state === 'failed') failed += 1
    }
    return { done, total: tracks.length, active, failed }
  }

  async addTrack(track: Track): Promise<void> {
    this.apply(await api.downloads.addTrack(track))
  }

  async addCollection(input: DownloadCollectionInput, tracks: Track[]): Promise<void> {
    this.apply(await api.downloads.addCollection(input, tracks))
  }

  async removeTrack(trackId: string): Promise<void> {
    this.pauseIfPlaying([trackId])
    this.apply(await api.downloads.removeTrack(trackId))
  }

  async removeCollection(key: string): Promise<void> {
    const collection = this.collections.find((item) => item.key === key)
    if (collection) this.pauseIfPlaying(collection.trackIds)
    this.apply(await api.downloads.removeCollection(key))
  }

  async pruneCollection(key: string, trackIds: string[]): Promise<void> {
    const collection = this.collections.find((item) => item.key === key)
    if (collection) {
      const keep = new Set(trackIds)
      this.pauseIfPlaying(collection.trackIds.filter((id) => !keep.has(id)))
    }
    this.apply(await api.downloads.pruneCollection(key, trackIds))
  }

  async clear(): Promise<void> {
    this.pauseIfPlaying(this.entries.map((entry) => entry.track.id))
    this.apply(await api.downloads.clear())
  }

  async retry(trackId: string): Promise<void> {
    this.apply(await api.downloads.retry(trackId))
  }

  async cancel(trackId: string): Promise<void> {
    this.apply(await api.downloads.cancel(trackId))
  }

  private apply(snapshot: DownloadsSnapshot): void {
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
}

export const downloads = new DownloadsStore()
