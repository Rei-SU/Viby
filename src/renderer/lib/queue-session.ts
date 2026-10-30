import type { PlaybackSession, Track } from '@shared/types'

/** How many queue rows a session keeps, and how many precede the current track. */
export const QUEUE_WINDOW_SIZE = 100
export const QUEUE_WINDOW_BEFORE = 20

export type QueueWindow = {
  queue: Track[]
  queueStart: number
}

/**
 * Save a window around the current track instead of the first N rows. A long
 * artist queue would otherwise persist an index beyond the truncated list and
 * restore the wrong song. The session keeps the absolute `index`; `queueStart`
 * maps it back into this window on restore.
 */
export function queueWindow(queue: Track[], index: number): QueueWindow {
  if (queue.length === 0 || index < 0) return { queue: [], queueStart: 0 }

  const start = Math.max(
    0,
    Math.min(index - QUEUE_WINDOW_BEFORE, queue.length - QUEUE_WINDOW_SIZE)
  )
  const end = Math.min(queue.length, start + QUEUE_WINDOW_SIZE)
  return {
    queue: queue.slice(start, end),
    queueStart: start
  }
}

/**
 * Rebuild the queue and its index from a saved session. `queueStart` is absent
 * in sessions written before windowing, where the queue began at zero.
 */
export function restoreQueue(saved: PlaybackSession): { queue: Track[]; index: number } {
  const queue = saved.queue?.length > 0 ? saved.queue : saved.track ? [saved.track] : []
  if (queue.length === 0) return { queue: [], index: -1 }

  const start = Number.isFinite(saved.queueStart) ? Math.max(0, Math.trunc(saved.queueStart!)) : 0
  const raw = Number.isFinite(saved.index) ? saved.index : 0
  return {
    queue,
    index: Math.min(Math.max(0, raw - start), queue.length - 1)
  }
}
