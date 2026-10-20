/**
 * Lyrics lookup + cache. Run:
 *   npx esbuild tests/lyrics.test.ts --bundle --platform=node --format=esm \
 *     --alias:@shared=./src/shared --alias:electron=./tests/electron-stub.ts \
 *     --outfile=/tmp/lyrics.mjs && node /tmp/lyrics.mjs
 */
import { fetchOvhLyrics, getLyrics } from '../src/main/lyrics'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const track = {
  trackId: 'khnokW3Mw24',
  title: 'Instant Crush (feat. Julian Casablancas)',
  artist: 'Daft Punk, Julian Casablancas',
  durationSec: 338
}

const first = await getLyrics(track)
console.log(`  kind=${first.kind} source=${first.source ?? '-'} lines=${first.lines?.length ?? 0}`)
check('finds synced lyrics', first.kind === 'synced', first.kind)
check('has a reasonable number of lines', (first.lines?.length ?? 0) > 15, `${first.lines?.length ?? 0}`)
check(
  'lines are sorted and non-empty',
  (first.lines ?? []).every(
    (line, i, all) => line.text.length > 0 && (i === 0 || all[i - 1].time <= line.time)
  )
)
check('first line has a sane timestamp', (first.lines?.[0]?.time ?? -1) >= 0)

const started = Date.now()
const second = await getLyrics(track)
const elapsed = Date.now() - started
check('second lookup is served from cache', elapsed < 50, `${elapsed}ms`)
check('cache returns the same kind', second.kind === first.kind)

const backup = await fetchOvhLyrics('Daft Punk', 'Instant Crush')
console.log(`  backup: kind=${backup?.kind} source=${backup?.source ?? '-'} chars=${backup?.plain?.length ?? 0}`)
check(
  'backup source returns plain lyrics',
  backup?.kind === 'plain' && backup?.source === 'lyrics.ovh' && (backup.plain?.length ?? 0) > 200
)
check('LRCLIB still wins when it has the track', first.kind === 'synced' && first.source === 'LRCLIB')

const missing = await getLyrics({
  trackId: 'definitely-not-a-track-xyz',
  title: 'Zzzz Qqqq Not A Real Song 12345',
  artist: 'Nobody At All',
  durationSec: 123
})
check('unknown track returns none', missing.kind === 'none', missing.kind)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
