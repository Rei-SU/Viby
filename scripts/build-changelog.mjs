#!/usr/bin/env node
/**
 * Bakes release notes into the app.
 *
 * The annotated tag is the only place release notes are written (see
 * CONTRIBUTING.md). The release workflow copies that message into the GitHub
 * release; this script copies the same message into the build so the What's New
 * sheet can show it offline, and still matches exactly what shipped.
 *
 *   node scripts/build-changelog.mjs
 *
 * Writes resources/changelog.json, which electron-builder packs into the app.
 * A checkout without tags (a source tarball) writes an empty list: the app then
 * simply has no notes to show.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Matches the sections the release-notes lint accepts. */
export const SECTION_TITLES = ['Added', 'Changed', 'Fixed', 'Removed', 'Security']

const TAG_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** `[major, minor, patch]`, or null for a tag we do not ship notes for. */
export function parseTagVersion(tag) {
  const match = TAG_RE.exec(tag.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

function compareParts(left, right) {
  for (let index = 0; index < 3; index++) {
    if (left[index] !== right[index]) return Math.sign(left[index] - right[index])
  }
  return 0
}

/**
 * Turn one tag message into sections of plain, display-ready bullets.
 *
 * Prose between sections (platform caveats, for example) is left out of the
 * sheet; it still reaches the GitHub release body.
 */
export function parseReleaseNotes(markdown) {
  const sections = []
  let current = null

  for (const raw of String(markdown ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = { title: heading[1], items: [] }
      sections.push(current)
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      current = null
      continue
    }
    if (!current) continue
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    if (!bullet) continue
    const text = plainText(bullet[1])
    if (text) current.items.push(text)
  }

  return sections.filter((section) => section.items.length > 0)
}

/** The sheet renders text, not Markdown, so drop the inline markers. */
function plainText(value) {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Newest first, never newer than the running version, and only tags that
 * actually carry notes. `repo` is the GitHub `owner/name` for the notes link.
 */
export function collectEntries(tags, currentVersion, repo = 'Rei-SU/Viby') {
  const current = parseTagVersion(currentVersion)
  if (!current) return []

  return tags
    .map((tag) => ({ ...tag, parts: parseTagVersion(tag.version) }))
    .filter((tag) => tag.parts && compareParts(tag.parts, current) <= 0)
    .sort((left, right) => compareParts(right.parts, left.parts))
    .map((tag) => ({
      version: tag.version.replace(/^v/, ''),
      date: tag.date ?? '',
      url: `https://github.com/${repo}/releases/tag/v${tag.version.replace(/^v/, '')}`,
      sections: parseReleaseNotes(tag.notes)
    }))
    .filter((entry) => entry.sections.length > 0)
}

/** Every annotated version tag in the repository, with its message and date. */
function readTags() {
  const names = execFileSync('git', ['tag', '--list', 'v*'], { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)

  return names.map((name) => {
    const raw = execFileSync(
      'git',
      ['tag', '--list', '--format=%(creatordate:short)%0a%(contents)', name],
      { cwd: root, encoding: 'utf8' }
    )
    const [date, ...rest] = raw.split(/\r?\n/)
    return { version: name.replace(/^v/, ''), date: date.trim(), notes: rest.join('\n') }
  })
}

function main() {
  let entries = []
  let version = ''
  let note = ''

  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    version = String(pkg.version ?? '')
    entries = collectEntries(readTags(), version, process.env.GITHUB_REPOSITORY || undefined)
    note = entries.length > 0 ? `latest ${entries[0].version}` : 'no version tags with notes'
  } catch (error) {
    note = `skipped (${error instanceof Error ? error.message : String(error)})`
  }

  // A release that ships without its own notes leaves the What's New sheet
  // with nothing to show and hides Settings > View notes. Release builds set
  // this so the problem fails the build instead of reaching users.
  if (
    process.env.VIBY_REQUIRE_CHANGELOG === '1' &&
    !entries.some((entry) => entry.version === version)
  ) {
    console.error(
      `changelog: no notes for ${version || 'the running version'}; refusing to build a release without them.`
    )
    process.exit(1)
  }

  const file = join(root, 'resources', 'changelog.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ entries }, null, 2)}\n`)
  console.log(`changelog: ${entries.length} release(s) baked, ${note}`)
}

// Only run the CLI when this file is the entry point (see update-manifest.mjs).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv[1].endsWith('build-changelog.mjs')
) {
  main()
}
