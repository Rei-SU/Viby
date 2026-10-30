/**
 * Recording aliases: one song under its catalog id and its released-audio id.
 * Run: node tests/unit.mjs recording-alias
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RecordingAliases } from '../src/main/recording-alias'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const root = mkdtempSync(join(tmpdir(), 'viby-alias-'))
const file = join(root, 'aliases.json')
const aliases = new RecordingAliases(file)

console.log('linking:')
aliases.link('audio1', 'row1')
check('the audio id knows its row', aliases.related('audio1').includes('row1'))
check('the row knows its audio id', aliases.related('row1').includes('audio1'))
check('the id itself is always included', aliases.related('audio1').includes('audio1'))
check('an unrelated id has no counterpart', aliases.related('other').length === 1)
check('related never duplicates', new Set(aliases.related('row1')).size === aliases.related('row1').length)

console.log('\nignored input:')
aliases.link('same', 'same')
check('equal ids are not a pairing', aliases.related('same').length === 1)
aliases.link('../escape', 'row2')
aliases.link('audio2', 'bad id!')
check('an unsafe audio id is ignored', aliases.related('row2').length === 1)
check('an unsafe row id is ignored', aliases.related('audio2').length === 1)
aliases.link('', 'row3')
check('an empty id is ignored', aliases.related('row3').length === 1)
aliases.link('a'.repeat(65), 'row4')
check('an oversized id is ignored', aliases.related('row4').length === 1)

console.log('\nrelinking a row:')
aliases.link('audio1', 'row1')
aliases.link('audio9', 'row1')
check('the row points at the newest audio', aliases.related('row1').includes('audio9'))
check('the old audio is detached', !aliases.related('audio1').includes('row1'))
check('the old audio still knows itself', aliases.related('audio1').join(',') === 'audio1')

console.log('\npersistence:')
const reopened = new RecordingAliases(file)
check('links survive a restart', reopened.related('row1').includes('audio9'))

console.log('\ncap:')
const cappedFile = join(root, 'capped.json')
const capped = new RecordingAliases(cappedFile, 3)
for (let i = 1; i <= 5; i++) capped.link(`audio${i}`, `row${i}`)
check('the oldest links are pruned', capped.related('row1').length === 1 && capped.related('row2').length === 1)
check('the newest links stay', capped.related('row3').includes('audio3') && capped.related('row5').includes('audio5'))
const stored = JSON.parse(readFileSync(cappedFile, 'utf8')) as { links: Record<string, unknown> }
check('the file holds only the cap', Object.keys(stored.links).length === 3, String(Object.keys(stored.links).length))

console.log('\nsanitizing a corrupt file:')
const corruptFile = join(root, 'corrupt.json')
writeFileSync(
  corruptFile,
  JSON.stringify({
    links: {
      good: { other: 'rowgood', at: 10 },
      equal: { other: 'equal', at: 10 },
      unsafe: { other: '../escape', at: 10 },
      badtime: { other: 'rowbad', at: 'later' },
      notobject: 'row'
    }
  })
)
const clean = new RecordingAliases(corruptFile)
check('a valid link survives', clean.related('good').includes('rowgood'))
check('an equal-id link is dropped', clean.related('equal').join(',') === 'equal')
check('an unsafe link is dropped', clean.related('unsafe').join(',') === 'unsafe')
check('a bad timestamp is dropped', clean.related('badtime').join(',') === 'badtime')
check('a non-object link is dropped', clean.related('notobject').join(',') === 'notobject')
const rewritten = JSON.parse(readFileSync(corruptFile, 'utf8')) as { links: Record<string, unknown> }
check('the file is rewritten clean', Object.keys(rewritten.links).join(',') === 'good')

console.log('\nwrong-shaped file:')
const shapedFile = join(root, 'shaped.json')
writeFileSync(shapedFile, JSON.stringify({ links: [] }))
const shaped = new RecordingAliases(shapedFile)
shaped.link('a2', 'r2')
check('a fresh index is usable', shaped.related('r2').includes('a2'))

rmSync(root, { recursive: true, force: true })
console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
