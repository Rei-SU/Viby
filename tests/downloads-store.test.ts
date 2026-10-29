/**
 * Downloads index: references, healing, orphan cleanup and stats. Run:
 *   node tests/unit.mjs downloads-store
 */
import { mkdtempSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { DownloadsStore } from '../src/main/downloads/store'
import type { Track } from '../src/shared/types'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const root = mkdtempSync(join(tmpdir(), 'viby-downloads-'))
const track = (id: string, title = id): Track => ({
  id,
  title,
  artist: 'Artist',
  durationSec: 200,
  thumbnail: 'https://example.test/cover.jpg'
})

function makeFile(dir: string, name: string, bytes = 1024): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, Buffer.alloc(bytes, 1))
  return file
}

/** Create a file at an exact path (used for content-addressed artwork). */
function makeFileAt(path: string, bytes = 1024): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, Buffer.alloc(bytes, 1))
  return path
}

const store = new DownloadsStore(root)

console.log('valid JSON with a wrong-shaped index does not delete audio:')
{
  const badRoot = mkdtempSync(join(tmpdir(), 'viby-downloads-bad-'))
  const audioDir = join(badRoot, 'audio')
  mkdirSync(audioDir, { recursive: true })
  const audio = join(audioDir, 'a.m4a')
  writeFileSync(audio, Buffer.from('keep me'))
  writeFileSync(
    join(badRoot, 'index.json'),
    JSON.stringify({ entries: [], collections: {}, jobs: {} })
  )

  new DownloadsStore(badRoot)
  check('the audio file survives', existsSync(audio))
  check(
    'a recovery marker is written',
    existsSync(join(badRoot, 'index.json.recovery-needed'))
  )
}

console.log('enqueue:')
const added = store.enqueue(
  [
    { track: track('a'), source: 'track:a' },
    { track: track('b'), source: 'playlist:p1' }
  ],
  'best'
)
check('queues missing tracks', added.join(',') === 'a,b', added.join(','))
check('no entries yet', store.entries().length === 0)
check('jobs are queued', store.allJobs().every(({ job }) => job.state === 'queued'))

console.log('\nput + lookup:')
const tmpA = makeFile(join(root, 'tmp', 'a'), 'a.m4a', 5_000_000)
const entry = store.put(track('a'), tmpA, 'm4a', ['track:a', 'album:z'], 'best')
check('entry recorded', store.entries().length === 1)
check('job cleared', store.allJobs().some(({ id }) => id === 'a') === false)
check('sources deduped', entry.sources.join(',') === 'track:a,album:z', entry.sources.join(','))
check('lookup finds the file', store.lookup('a') !== null)
check('ext recorded', store.extOf('a') === 'm4a')
check('bitrate from duration', typeof entry.bitrateKbps === 'number' && entry.bitrateKbps > 0)
check('artUrl decorated', entry.artUrl === undefined)

console.log('\npatch credits:')
{
  const patched = store.patchTrack('a', {
    artist: 'The Neighbourhood',
    artistId: 'UC1cnYMXqKdazz-gDPKaDFyg',
    album: 'Hard To Imagine The Neighbourhood Ever Changing'
  })
  check('patch reports a change', patched)
  check('artist replaced', store.entry('a')?.track.artist === 'The Neighbourhood')
  check('album filled', store.entry('a')?.track.album?.startsWith('Hard To Imagine') === true)
  check('missing id is a no-op', store.patchTrack('not-a-track', { artist: 'x' }) === false)
  check('other entries untouched', store.entry('b') === null)
}

console.log('\nreference add on an existing entry:')
store.enqueue([{ track: track('a'), source: 'playlist:p1' }], 'best')
check(
  'existing entry gains the source without a job',
  store.entry('a')?.sources.includes('playlist:p1') === true &&
    store.allJobs().some(({ id }) => id === 'a') === false
)

console.log('\npruneCollection:')
const tmpC = makeFile(join(root, 'tmp', 'c'), 'c.m4a')
store.put(track('c'), tmpC, 'm4a', ['playlist:p1'], 'best')
const affected = store.pruneCollection('playlist:p1', [])
check('track dropped from the playlist is deleted', store.entry('c') === null)
check('a queued member of the playlist is cancelled too', affected.join(',') === 'b', affected.join(','))
check('its queued job is gone', store.allJobs().some(({ id }) => id === 'b') === false)
check('unrelated track survives', store.entry('a') !== null)
check('a keeps its other sources', store.entry('a')?.sources.join(',') === 'track:a,album:z')

console.log('\nremoveCollection keeps shared files:')
store.addCollection({ key: 'album:z', kind: 'album', title: 'Z', trackIds: ['a'] })
const affectedJobs = store.removeCollection('album:z')
check('album reference removed', store.entry('a')?.sources.includes('album:z') === false)
check('file survives via track source', store.entry('a') !== null)
check('collection removed from index', store.collection('album:z') === null)
check('no jobs affected', affectedJobs.length === 0)

console.log('\nqueue-only track cancels with its collection:')
store.addCollection({ key: 'playlist:p2', kind: 'playlist', title: 'P2', trackIds: ['b'] })
store.enqueue([{ track: track('b'), source: 'playlist:p2' }], 'best')
const jobs = store.removeCollection('playlist:p2')
check('queued job removed', jobs.join(',') === 'b', jobs.join(','))
check('job gone from index', store.allJobs().length === 0)

console.log('\npath safety:')
check('safeId strips separators', store.safeId('../../etc/passwd') === '______etc_passwd', store.safeId('../../etc/passwd'))
check('safeId allows normal ids', store.safeId('dQw4w9WgXcQ') === 'dQw4w9WgXcQ')

console.log('\nremoveTrack:')
const before = store.entries().length
store.removeTrack('a')
check('entry gone', store.entry('a') === null)
check('one fewer entry', store.entries().length === before - 1)
check('file gone or healed', store.lookup('a') === null)

console.log('\nartwork is reference counted:')
// Two entries sharing one content-addressed cover.
const sharedArt = store.artNameFor('https://example.test/shared.jpg', 'jpg')
const sharedName = sharedArt.split(/[\\/]/).pop() as string
makeFileAt(join(store.dir, sharedArt), 4096)
const tmpX = makeFile(join(root, 'tmp', 'x'), 'x.m4a')
store.put(track('x'), tmpX, 'm4a', ['track:x'], 'best', sharedArt)
const tmpY = makeFile(join(root, 'tmp', 'y'), 'y.m4a')
store.put(track('y'), tmpY, 'm4a', ['track:y'], 'best', sharedArt)

store.removeTrack('x')
check('shared artwork survives one removal', existsSync(join(store.artDir, sharedName)))
store.removeTrack('y')
check('artwork removed with its last owner', existsSync(join(store.artDir, sharedName)) === false)

console.log('\nlyrics are pinned to the download:')
const tmpL = makeFile(join(root, 'tmp', 'l'), 'l.m4a')
store.put(track('l'), tmpL, 'm4a', ['track:l'], 'best')
store.putLyrics('l', {
  kind: 'synced',
  lines: [{ time: 0, text: 'Hello' }, { time: 4, text: 'World' }],
  source: 'LRCLIB'
})
check('lyrics read back', store.lyrics('l')?.lines?.[1]?.text === 'World')
store.removeLyrics('l')
check('removeLyrics drops the pinned copy', store.lyrics('l') === null)
store.putLyrics('l', { kind: 'plain', plain: 'again' })
store.putLyrics('missing-entry', { kind: 'plain', plain: 'nope' })
check('lyrics without an entry are ignored', store.lyrics('missing-entry') === null)
store.removeTrack('l')
check('lyrics are deleted with the entry', store.lyrics('l') === null)
check('lyrics file is gone', existsSync(store.lyricsPath('l')) === false)

console.log('\nalbum art covers tracks without their own thumbnail:')
const tmpM = makeFile(join(root, 'tmp', 'm'), 'm.m4a')
store.put(track('m'), tmpM, 'm4a', ['album:cover'], 'best')
const coverArt = store.artNameFor('https://example.test/album-cover.jpg', 'jpg')
makeFileAt(join(store.dir, coverArt), 2048)
store.addCollection({
  key: 'album:cover',
  kind: 'album',
  title: 'Cover',
  thumbnail: 'https://example.test/album-cover.jpg',
  trackIds: ['m']
})
store.setCollectionArt('album:cover', coverArt)
check('entry borrows the collection cover at read time', Boolean(store.entry('m')?.artUrl))
check('entry keeps no art path of its own', store.entry('m')?.art === undefined)

console.log('\nhealing on startup:')
// Simulate a crash: an entry whose file disappeared.
const fresh = new DownloadsStore(mkdtempSync(join(tmpdir(), 'viby-downloads-')))
const tmpD = makeFile(join(fresh.tmpDir, 'd'), 'd.m4a')
fresh.put(track('d'), tmpD, 'm4a', ['track:d'], 'best')
const audioFile = fresh.lookup('d')
check('seed file exists', audioFile !== null && existsSync(audioFile))
// An entry with artwork, plus an orphan art file with no owner.
const tmpE = makeFile(join(fresh.tmpDir, 'e'), 'e.m4a', 2048)
const artRel = fresh.artNameFor('https://example.test/e.jpg', 'jpg')
makeFileAt(join(fresh.dir, artRel), 16)
fresh.put(track('e'), tmpE, 'm4a', ['track:e'], 'best', artRel)
makeFile(fresh.artDir, 'orphan.jpg', 16)
// An album download whose tracks have no thumbnail of their own: healing should
// pin the cached collection cover onto each entry.
const tmpF = makeFile(join(fresh.tmpDir, 'f'), 'f.m4a', 2048)
fresh.put(track('f'), tmpF, 'm4a', ['album:fa'], 'best')
const albumArtRel = fresh.artNameFor('https://example.test/fa.jpg', 'jpg')
makeFileAt(join(fresh.dir, albumArtRel), 16)
fresh.addCollection({
  key: 'album:fa',
  kind: 'album',
  title: 'FA',
  thumbnail: 'https://example.test/fa.jpg',
  trackIds: ['f']
})
fresh.setCollectionArt('album:fa', albumArtRel)
check('collection art is used before a restart', Boolean(fresh.entry('f')?.artUrl))
// A collection can outlive its art file (removed outside Viby, or copied from
// another install). It must fall back instead of handing the renderer a dead
// `viby-media://` URL.
const missingArtRel = fresh.artNameFor('https://example.test/missing.jpg', 'jpg')
fresh.addCollection({
  key: 'album:missing',
  kind: 'album',
  title: 'Missing',
  thumbnail: 'https://example.test/missing.jpg',
  trackIds: ['g']
})
fresh.setCollectionArt('album:missing', missingArtRel)
const tmpG = makeFile(join(fresh.tmpDir, 'g'), 'g.m4a', 2048)
fresh.put(track('g'), tmpG, 'm4a', ['album:missing'], 'best')
check(
  'dead collection art is not decorated',
  fresh.collection('album:missing')?.artUrl === undefined
)
check('dead entry art is not decorated', fresh.entry('g')?.artUrl === undefined)
check(
  'collection keeps its remote thumbnail',
  fresh.collection('album:missing')?.thumbnail === 'https://example.test/missing.jpg'
)
// A lyrics file left behind by a crash has no entry to belong to.
makeFile(fresh.lyricsDir, 'ghost.json', 8)
// A file with no entry (Windows deferred deletion) is swept on the next launch.
makeFile(join(fresh.audioDir), 'orphan.m4a', 32)
// A partial tmp dir with no job is swept too.
makeFile(join(fresh.tmpDir, 'ghost'), 'ghost.part', 32)
const reopened = new DownloadsStore(fresh.dir)
check('orphan audio removed', existsSync(join(fresh.audioDir, 'orphan.m4a')) === false)
check(
  'orphan tmp dir removed',
  readdirSync(fresh.tmpDir).includes('ghost') === false,
  readdirSync(fresh.tmpDir).join(',')
)
check('referenced artwork survives', existsSync(join(fresh.root, artRel)) === true)
check('orphan artwork removed', existsSync(join(fresh.artDir, 'orphan.jpg')) === false)
check('orphan lyrics removed', existsSync(join(fresh.lyricsDir, 'ghost.json')) === false)
check('valid entry survives', reopened.entry('d') !== null)
check('entry keeps its art path', reopened.entry('e')?.art === artRel)
check('entry without a thumbnail keeps the album cover', reopened.entry('f')?.art === albumArtRel)
check(
  'missing collection art is cleared on startup',
  reopened.collection('album:missing')?.art === undefined
)
check('missing entry art is cleared on startup', reopened.entry('g')?.art === undefined)
check(
  'collection keeps its thumbnail after healing',
  reopened.collection('album:missing')?.thumbnail === 'https://example.test/missing.jpg'
)


console.log('\ncorrupt index recovery:')
const recoveryRoot = mkdtempSync(join(tmpdir(), 'viby-downloads-corrupt-'))
mkdirSync(join(recoveryRoot, 'audio'), { recursive: true })
const orphan = join(recoveryRoot, 'audio', 'keep-me.m4a')
writeFileSync(orphan, Buffer.alloc(2048, 1))
writeFileSync(join(recoveryRoot, 'index.json'), '{"entries":')
const recovered = new DownloadsStore(recoveryRoot)
check('starts empty after an unreadable index', recovered.entries().length === 0)
check('does not delete audio it cannot reference', existsSync(orphan))
check(
  'leaves a recovery marker',
  existsSync(join(recoveryRoot, 'index.json.recovery-needed'))
)
check(
  'keeps the corrupt index as a backup',
  readdirSync(recoveryRoot).some((name) => name.startsWith('index.json.corrupt-'))
)

recovered.clear()
check('an explicit clear removes the marker', !existsSync(join(recoveryRoot, 'index.json.recovery-needed')))
check('an explicit clear removes preserved files', !existsSync(orphan))

console.log('\nclear:')
reopened.clear()
check('no entries after clear', reopened.entries().length === 0)
check('no jobs after clear', reopened.allJobs().length === 0)
check(
  'audio dir empty after clear',
  readdirSync(reopened.audioDir).length === 0
)
check('art dir empty after clear', readdirSync(reopened.artDir).length === 0)
check('lyrics dir empty after clear', readdirSync(reopened.lyricsDir).length === 0)

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
