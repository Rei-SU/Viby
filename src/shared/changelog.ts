import type { ChangelogEntry } from './types'
import { compareVersions, isNewer } from './version'

/**
 * Which notes a launch should show.
 *
 * The stored baseline is `lastSeenVersion`, but it is not enough on its own:
 * every install that predates the sheet has an empty value, and 0.5.0 wrote a
 * baseline without ever displaying anything. `lastShownVersion` records what
 * was actually put on screen, so an install that was never shown a sheet can
 * catch up on the version that was silently marked as seen.
 */

/** Newest baked version strictly older than `version`, or '' when none is. */
export function previousVersion(
  entries: readonly ChangelogEntry[],
  version: string
): string {
  if (!version) return ''
  for (const entry of entries) {
    if (compareVersions(entry.version, version) < 0) return entry.version
  }
  return ''
}

function baselineFor(
  entries: readonly ChangelogEntry[],
  seen: string,
  shown: string
): string {
  // Never shown: the recorded version was only a baseline written by a build
  // that had no sheet to show. Include its notes as well.
  if (!shown) {
    if (!seen) {
      // No record at all: an install from before the sheet. We cannot know
      // what it saw, so show the running version's notes and nothing older.
      return previousVersion(entries, entries[0]?.version ?? '')
    }
    return previousVersion(entries, seen)
  }
  if (!seen) return shown
  return isNewer(shown, seen) ? shown : seen
}

/**
 * Notes newer than the baseline, newest first. A first install gets nothing:
 * there is no earlier version to catch up on, and a wall of old notes is not
 * a welcome.
 */
export function unseenEntries(
  entries: readonly ChangelogEntry[],
  seen: string,
  shown: string,
  firstRun: boolean
): ChangelogEntry[] {
  if (firstRun) return []
  const baseline = baselineFor(entries, seen, shown)
  return entries.filter((entry) => isNewer(entry.version, baseline))
}
