import { trackTitleKey } from './track-title'

export type TrackMatchTarget = {
  id?: string
  title: string
  durationSec?: number
}

export type TrackMatchRow = {
  id?: string
  title: string
  durationSec?: number
}

/** Close enough to be the same recording; versions differ by far more. */
const DURATION_TOLERANCE_SEC = 8

/**
 * Search-friendly title for album discovery. Parenthetical qualifiers
 * ("(feat. …)", "(Official Video)", "(Live)") make YouTube's album search miss
 * the release, so they are dropped from the query only; matching stays strict.
 */
export function releaseSearchTitle(title: string): string {
  return title.replace(/[\[(][^\])]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim() || title.trim()
}

/**
 * Find the row on a release page that matches a clicked song.
 *
 * Search results often point at a music video while the release lists the
 * official audio, so ids differ. Falling back to the title alone can light up
 * the wrong row when a release has two versions of a song; duration breaks the
 * tie, and a version mismatch (radio edit vs album cut) matches nothing rather
 * than the wrong recording.
 */
export function pickTrackIndex(
  rows: readonly TrackMatchRow[],
  target: TrackMatchTarget
): number {
  if (rows.length === 0) return -1

  if (target.id) {
    const exact = rows.findIndex((row) => row.id === target.id)
    if (exact >= 0) return exact
  }

  const key = trackTitleKey(target.title)
  const same = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => trackTitleKey(row.title) === key)
  if (same.length === 0) return -1

  const wanted = target.durationSec ?? 0
  if (wanted <= 0) return same[0].index

  let best = same[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const candidate of same) {
    const duration = candidate.row.durationSec ?? 0
    if (duration <= 0) continue
    const delta = Math.abs(duration - wanted)
    if (delta < bestDelta) {
      best = candidate
      bestDelta = delta
    }
  }
  // No durations on the page: the title is all we have.
  if (bestDelta === Number.POSITIVE_INFINITY) return same[0].index
  return bestDelta <= DURATION_TOLERANCE_SEC ? best.index : -1
}
