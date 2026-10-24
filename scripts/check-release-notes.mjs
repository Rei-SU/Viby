#!/usr/bin/env node
/**
 * Release notes lint.
 *
 * Release notes are the annotated tag message and become the GitHub release
 * body. They are read by people using Viby, not by people reading the code:
 * every line must describe something they can see or do.
 *
 *   node scripts/check-release-notes.mjs release-notes.md
 *
 * Rejects missing/empty/unknown sections and internal jargon that belongs in
 * the commit message instead. Run by prepare-release before the draft exists.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SECTIONS = new Set(['Added', 'Changed', 'Fixed', 'Removed', 'Security'])

/**
 * Terms that only make sense to someone reading the code or the build logs.
 * Keep this list about implementation, not about the product: "Windows",
 * "macOS", "installer" and "update" are fine.
 */
const BANNED = [
  [/\bed25519\b/i, 'Ed25519'],
  [/\bsha-?(?:1|256|512)\b/i, 'SHA'],
  [/\bchecksums?\b/i, 'checksum'],
  [/\b(?:hash|hashes|hashed|hashing)\b/i, 'hash'],
  [/\bmanifests?\b/i, 'manifest'],
  [/\bsignatures?\b/i, 'signature'],
  [/\bnsis\b/i, 'NSIS'],
  [/\belectron(?:-updater)?\b/i, 'Electron'],
  [/\bblockmap\b/i, 'blockmap'],
  [/\blatest\.ya?ml\b/i, 'latest.yml'],
  [/\b(?:json|ya?ml)\b/i, 'JSON/YAML'],
  [/\bapi\b/i, 'API'],
  [/\bci\b/i, 'CI'],
  [/\bworkflows?\b/i, 'workflow'],
  [/\bstack traces?\b/i, 'stack trace'],
  [/\bdebug(?:ging)?\b/i, 'debug'],
  [/\blogs?\b/i, 'log'],
  [/\bweb[- ]installer\b/i, 'web installer'],
  [/\bpartial files?\b/i, 'partial file'],
  [/\bupdater\b/i, 'updater'],
  [/\bendpoints?\b/i, 'endpoint'],
  [/\bnpm\b/i, 'npm'],
  [/\bnode(?:\.js)?\b/i, 'Node'],
  [/\brepo(?:sitory)?\b/i, 'repository'],
  [/\bcommits?\b/i, 'commit'],
  [/\brefactor(?:ed|ing)?\b/i, 'refactor']
]

/**
 * @param {string} markdown
 * @returns {string[]} human-readable problems, empty when the notes pass
 */
export function checkReleaseNotes(markdown) {
  const errors = []
  const lines = markdown.split(/\r?\n/)
  const sections = []
  const seen = new Set()
  let current = null

  for (const line of lines) {
    const heading = /^###\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const name = heading[1]
      if (!SECTIONS.has(name)) {
        errors.push(`Unknown section "### ${name}". Use Added, Changed, Fixed, Removed or Security.`)
      }
      if (seen.has(name)) {
        errors.push(`"### ${name}" appears more than once; merge the bullets.`)
      }
      seen.add(name)
      current = { name, bullets: 0 }
      sections.push(current)
      continue
    }

    if (/^#{1,2}\s/.test(line)) {
      errors.push(`Use "### Added" style headings, not "${line.trim()}".`)
      current = null
      continue
    }

    if (current && /^\s*-\s+\S/.test(line)) current.bullets++
  }

  if (sections.length === 0) {
    errors.push('No sections. Add "### Added", "### Changed", "### Fixed", "### Removed" or "### Security".')
  }

  for (const section of sections) {
    if (section.bullets === 0) {
      errors.push(`"### ${section.name}" has no bullet points.`)
    }
  }

  for (const [pattern, label] of BANNED) {
    const match = pattern.exec(markdown)
    if (match) {
      errors.push(
        `Remove "${match[0]}" (${label}). Describe what the user sees or can do, not how it is built.`
      )
    }
  }

  return errors
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('Usage: node scripts/check-release-notes.mjs <notes.md>')
    process.exit(1)
  }

  const errors = checkReleaseNotes(readFileSync(file, 'utf8'))
  if (errors.length > 0) {
    console.error(`Release notes in ${file} are not ready:`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  console.log(`Release notes OK (${file}).`)
}

// Only run the CLI when this file is the actual entry point (see update-manifest.mjs).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href &&
  process.argv[1].endsWith('check-release-notes.mjs')
) {
  main()
}
