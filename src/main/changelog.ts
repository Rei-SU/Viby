import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { compareVersions } from '@shared/version'
import type { ChangelogEntry, ChangelogInfo } from '@shared/types'
import { isFirstRun } from './settings'

/**
 * Release notes baked into the build from the annotated tags
 * (`scripts/build-changelog.mjs`). They ship inside the app, so the What's New
 * sheet works offline and describes exactly the version that is running.
 *
 * A source checkout without tags has no file; that is not an error.
 */
let cached: ChangelogEntry[] | null = null

function isSection(value: unknown): value is { title: string; items: string[] } {
  if (!value || typeof value !== 'object') return false
  const section = value as { title?: unknown; items?: unknown }
  return (
    typeof section.title === 'string' &&
    Array.isArray(section.items) &&
    section.items.every((item) => typeof item === 'string')
  )
}

function isEntry(value: unknown): value is ChangelogEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.version === 'string' &&
    typeof entry.date === 'string' &&
    typeof entry.url === 'string' &&
    Array.isArray(entry.sections) &&
    entry.sections.every(isSection)
  )
}

function load(): ChangelogEntry[] {
  if (cached) return cached
  cached = []
  try {
    const raw = readFileSync(join(app.getAppPath(), 'resources', 'changelog.json'), 'utf8')
    const parsed = JSON.parse(raw) as { entries?: unknown }
    if (Array.isArray(parsed.entries)) cached = parsed.entries.filter(isEntry)
  } catch {
    // No baked notes (local build without tags). The sheet simply stays closed.
  }
  return cached
}

export function changelogInfo(): ChangelogInfo {
  const version = app.getVersion()
  return {
    version,
    // A tag can be ahead of package.json in a dev checkout; never show notes
    // for a version this build does not contain.
    entries: load().filter((entry) => compareVersions(entry.version, version) <= 0),
    firstRun: isFirstRun()
  }
}
