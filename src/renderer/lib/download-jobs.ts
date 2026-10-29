import type {
  DownloadCollection,
  DownloadJobState,
  DownloadJobView,
  DownloadsSnapshot
} from '@shared/types'

export type DownloadJobGroup = {
  key: string
  title: string
  thumbnail?: string
  total: number
  done: number
  percent: number
  state: DownloadJobState
  jobs: DownloadJobView[]
  collection: DownloadCollection | null
  /** Collection key to cancel; null for the loose-songs group. */
  cancelKey: string | null
}

const STATE_RANK: Record<DownloadJobState, number> = {
  downloading: 0,
  queued: 1,
  paused: 2,
  failed: 3
}

function collectionSource(job: DownloadJobView): string | null {
  return (
    job.sources.find(
      (source) =>
        source === 'liked' || source.startsWith('album:') || source.startsWith('playlist:')
    ) ?? null
  )
}

function groupState(jobs: DownloadJobView[]): DownloadJobState {
  if (jobs.some((job) => job.state === 'downloading')) return 'downloading'
  if (jobs.some((job) => job.state === 'queued')) return 'queued'
  if (jobs.some((job) => job.state === 'paused')) return 'paused'
  return 'failed'
}

/**
 * Group pending download jobs by their owning album/playlist/liked collection.
 * Completed entries are only used for coverage counts; jobs for loose songs go
 * into one final "Songs" group.
 */
export function groupDownloadJobs(
  snapshot: DownloadsSnapshot | null,
  liveJobs?: Record<string, DownloadJobView>
): DownloadJobGroup[] {
  if (!snapshot) return []
  const jobs = liveJobs ? Object.values(liveJobs) : snapshot.jobs
  if (jobs.length === 0) return []

  const collections = new Map(snapshot.collections.map((collection) => [collection.key, collection]))
  const groups = new Map<string, DownloadJobGroup>()

  for (const job of jobs) {
    const source = collectionSource(job)
    const key = source ?? 'songs'
    let group = groups.get(key)
    if (!group) {
      const collection = source ? (collections.get(source) ?? null) : null
      group = {
        key,
        title:
          collection?.title ??
          (source === 'liked'
            ? 'Liked songs'
            : source?.startsWith('playlist:')
              ? 'Playlist'
              : source
                ? 'Album'
                : 'Songs'),
        thumbnail: collection?.artUrl ?? collection?.thumbnail ?? job.track.thumbnail,
        total: 0,
        done: 0,
        percent: 0,
        state: 'failed',
        jobs: [],
        collection,
        cancelKey: source
      }
      groups.set(key, group)
    }
    group.jobs.push(job)
    group.thumbnail ??= job.track.thumbnail
  }

  const ordered: DownloadJobGroup[] = []
  const seen = new Set<string>()
  for (const collection of snapshot.collections) {
    const group = groups.get(collection.key)
    if (!group) continue
    ordered.push(group)
    seen.add(collection.key)
  }
  for (const [key, group] of groups) {
    if (key === 'songs' || seen.has(key)) continue
    ordered.push(group)
    seen.add(key)
  }
  const songs = groups.get('songs')
  if (songs) ordered.push(songs)

  for (const group of ordered) {
    group.jobs.sort(
      (a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.track.title.localeCompare(b.track.title)
    )
    group.state = groupState(group.jobs)

    if (group.collection) {
      const collection = group.collection
      group.total = collection.trackIds.length || group.jobs.length
      const ids = new Set(collection.trackIds)
      group.done = snapshot.entries.filter((entry) => ids.has(entry.track.id)).length
      const active = group.jobs.find((job) => job.state === 'downloading')
      group.percent =
        group.total > 0
          ? Math.min(100, ((group.done + (active?.percent ?? 0) / 100) / group.total) * 100)
          : 0
    } else {
      group.total = group.jobs.length
      group.done = 0
      group.percent =
        group.jobs.reduce(
          (sum, job) => sum + (job.state === 'downloading' ? (job.percent ?? 0) : 0),
          0
        ) / group.jobs.length
    }
  }

  return ordered
}
