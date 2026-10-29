import type { LyricsLine } from '@shared/types'

/**
 * Index of the last line whose timestamp has been reached, or -1 before the
 * first one. Equal timestamps resolve to the later line, matching document
 * order. Synced lyrics are sorted by time when parsed.
 */
export function lineIndexAt(lines: readonly LyricsLine[], time: number): number {
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time > time) break
    index = i
  }
  return index
}
