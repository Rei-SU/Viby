/**
 * Changelog baking. Run:
 *   node tests/unit.mjs changelog
 */
import {
  collectEntries,
  parseReleaseNotes,
  parseTagVersion
} from '../scripts/build-changelog.mjs'
import { previousVersion, unseenEntries } from '../src/shared/changelog'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const notes = `### Added
- A new thing.
- Another **bold** thing.

Some prose the GitHub body keeps but the sheet does not.

### Fixed
- [A link](https://example.test) that broke.
`

console.log('parsing a tag message:')
{
  const sections = parseReleaseNotes(notes)
  check('keeps the section order', sections.map((s) => s.title).join(',') === 'Added,Fixed')
  check('keeps every bullet', sections[0].items.length === 2 && sections[1].items.length === 1)
  check('drops prose between sections', !JSON.stringify(sections).includes('prose'))
  check('strips emphasis', sections[0].items[1] === 'Another bold thing.', sections[0].items[1])
  check('keeps link text only', sections[1].items[0] === 'A link that broke.', sections[1].items[0])
}

console.log('\nignoring what cannot be shown:')
{
  check('a tag with no sections is empty', parseReleaseNotes('Viby 0.1.0').length === 0)
  check(
    'an empty section is dropped',
    parseReleaseNotes('### Added\n\n### Fixed\n- Something.\n').length === 1
  )
  check('headings above level three stop the section', parseReleaseNotes('## Added\n- Nope.\n').length === 0)
}

console.log('\ncollecting entries:')
{
  const entries = collectEntries(
    [
      { version: '0.1.2', date: '2026-10-22', notes: '### Added\n- Old.\n' },
      { version: '0.1.0', date: '2026-10-20', notes: 'Viby 0.1.0' },
      { version: '0.3.0', date: '2026-11-01', notes: '### Added\n- Unreleased.\n' },
      { version: '0.2.0', date: '2026-10-24', notes: '### Fixed\n- Middle.\n' }
    ],
    '0.2.0',
    'owner/name'
  )
  check('newest first', entries.map((e) => e.version).join(',') === '0.2.0,0.1.2')
  check('never ahead of the running version', !entries.some((e) => e.version === '0.3.0'))
  check('tags without notes are skipped', !entries.some((e) => e.version === '0.1.0'))
  check('dates are kept', entries[0].date === '2026-10-24')
  check(
    'release links use the tag',
    entries[0].url === 'https://github.com/owner/name/releases/tag/v0.2.0',
    entries[0].url
  )
}

console.log('\ntag versions:')
{
  check('accepts v-prefixed and bare tags', parseTagVersion('v1.2.3')?.join('.') === '1.2.3')
  check('accepts a bare version', parseTagVersion('0.2.4')?.join('.') === '0.2.4')
  check('rejects a prerelease', parseTagVersion('1.2.3-beta.1') === null)
  check('rejects a non-version tag', parseTagVersion('latest') === null)
}

console.log('\nwhat a launch should show:')
{
  const entry = (version: string) => ({
    version,
    date: '',
    url: '',
    sections: [{ title: 'Fixed', items: ['Something.'] }]
  })
  const entries = ['0.5.1', '0.5.0', '0.2.4', '0.2.3', '0.2.2'].map(entry)
  const versions = (list: { version: string }[]) => list.map((item) => item.version).join(',')

  check('a first install shows nothing', unseenEntries(entries, '', '', true).length === 0)
  check(
    'an install from before the sheet shows the running version only',
    versions(unseenEntries(entries, '', '', false)) === '0.5.1',
    versions(unseenEntries(entries, '', '', false))
  )
  check(
    'a version recorded without a sheet is shown again',
    versions(unseenEntries(entries, '0.5.0', '', false)) === '0.5.1,0.5.0',
    versions(unseenEntries(entries, '0.5.0', '', false))
  )
  check(
    'once shown, only newer notes are offered',
    versions(unseenEntries(entries, '0.5.0', '0.5.0', false)) === '0.5.1',
    versions(unseenEntries(entries, '0.5.0', '0.5.0', false))
  )
  check(
    'being current offers nothing',
    unseenEntries(entries, '0.5.1', '0.5.1', false).length === 0
  )
  check(
    'a shown version ahead of seen is not offered twice',
    versions(unseenEntries(entries, '0.2.4', '0.5.0', false)) === '0.5.1',
    versions(unseenEntries(entries, '0.2.4', '0.5.0', false))
  )
  check('previousVersion finds the entry below seen', previousVersion(entries, '0.5.0') === '0.2.4')
  check('previousVersion is empty for the oldest entry', previousVersion(entries, '0.2.2') === '')
  check('previousVersion is empty without a baseline', previousVersion(entries, '') === '')
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
