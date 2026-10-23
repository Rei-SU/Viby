/**
 * Release notes lint. Run:
 *   node tests/unit.mjs release-notes
 */
import { checkReleaseNotes } from '../scripts/check-release-notes.mjs'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function errorsFor(markdown: string): string[] {
  return checkReleaseNotes(markdown)
}

const valid = `### Added

- Update checks in Settings, with a dot when a new version is ready.

### Fixed

- Update errors now explain what went wrong in plain language.

**macOS:** builds are not code-signed yet. Approve Viby in System Settings →
Privacy & Security → Open Anyway.`

console.log('valid notes:')
{
  const errors = errorsFor(valid)
  check('accepts user-facing sections and platform notes', errors.length === 0, errors.join('; '))
}

console.log('\nstructure:')
{
  const errors = errorsFor('Viby 0.1.2\n')
  check('rejects a tag with no sections', errors.some((e) => e.includes('No sections')))
}
{
  const errors = errorsFor('### Added\n### Fixed\n- Update errors are readable now.\n')
  check('rejects an empty section', errors.some((e) => e.includes('### Added') && e.includes('no bullet')))
}
{
  const errors = errorsFor('### Notes\n- Something changed.\n')
  check('rejects an unknown section', errors.some((e) => e.includes('Unknown section')))
}
{
  const errors = errorsFor('## Added\n- Something changed.\n')
  check('rejects a level-two heading', errors.some((e) => e.includes('### Added')))
}
{
  const errors = errorsFor('### Added\n- One thing.\n\n### Added\n- Another thing.\n')
  check('rejects duplicate sections', errors.some((e) => e.includes('more than once')))
}
{
  const errors = errorsFor('### Fixed\n-\n')
  check('does not count an empty bullet', errors.some((e) => e.includes('no bullet')))
}

console.log('\ninternal jargon:')
{
  const errors = errorsFor('### Security\n- Releases use an Ed25519 manifest of SHA-256 hashes.\n')
  check('rejects Ed25519', errors.some((e) => e.includes('Ed25519')))
  check('rejects a manifest', errors.some((e) => e.includes('manifest')))
  check('rejects a SHA-256 hash', errors.some((e) => e.includes('SHA-256')))
}
{
  const errors = errorsFor('### Fixed\n- The updater writes a stack trace to the log.\n')
  check('rejects updater/log/stack trace', errors.some((e) => e.includes('updater')))
}
{
  const errors = errorsFor('### Fixed\n- Fixed an NSIS blockmap issue in CI.\n')
  check('rejects build tooling', errors.some((e) => e.includes('NSIS')))
}
{
  const errors = errorsFor('### Changed\n- The API returns a 404 for removed albums.\n')
  check('rejects API jargon', errors.some((e) => e.includes('API')))
}

console.log('\nline endings:')
{
  const errors = errorsFor(valid.replace(/\n/g, '\r\n'))
  check('accepts CRLF notes', errors.length === 0, errors.join('; '))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
