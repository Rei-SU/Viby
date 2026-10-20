import { JsonStore, userDataFile } from './json-store'
import type { PlaybackSession } from '@shared/types'

const EMPTY: PlaybackSession = {
  track: null,
  queue: [],
  index: -1,
  position: 0,
  updatedAt: 0
}

let store: JsonStore<PlaybackSession> | null = null

/**
 * The last thing that was playing and where it stopped. Restored on launch so
 * the app opens on your track, paused at the same timestamp.
 */
export function session(): JsonStore<PlaybackSession> {
  if (!store) store = new JsonStore<PlaybackSession>(userDataFile('session.json'), EMPTY)
  return store
}
