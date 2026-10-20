/**
 * Import adapters + matcher. The adapter checks are live (one small public
 * playlist per service); the matcher checks use a fake search so scoring is
 * deterministic. Run with:
 *
 *   node tests/unit.mjs import
 */
import type { CatalogItem, ImportSource, ImportTrack } from '../src/shared/types'
import { detectImportUrl } from '../src/main/import/detect'
import { resolveDeezer } from '../src/main/import/deezer'
import { resolveApple } from '../src/main/import/apple'
import { resolveSoundcloud } from '../src/main/import/soundcloud'
import { resolveYoutube } from '../src/main/import/youtube'
import { matchImport } from '../src/main/import/matcher'

let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'dQw4w9WgXcQ',
    kind: 'song',
    title: 'Dreams',
    subtitle: 'Fleetwood Mac',
    artists: ['Fleetwood Mac'],
    durationSec: 258,
    videoType: 'audio',
    ...overrides
  }
}

function source(track: ImportTrack, service: ImportSource['service'] = 'deezer'): ImportSource {
  return {
    service,
    kind: 'playlist',
    title: 'Test playlist',
    totalTracks: 1,
    tracks: [track]
  }
}

console.log('import detection\n')
const spotify = await detectImportUrl(
  'https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=abc'
)
check('spotify link', spotify.service === 'spotify' && spotify.id === '37i9dQZF1DWXRqgorJj26U', JSON.stringify(spotify))
const apple = await detectImportUrl(
  'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'
)
check('apple link', apple.service === 'apple', JSON.stringify(apple))
const deezer = await detectImportUrl('https://www.deezer.com/en/playlist/908622995')
check('deezer link', deezer.service === 'deezer' && deezer.id === '908622995', JSON.stringify(deezer))
const youtube = await detectImportUrl('https://music.youtube.com/playlist?list=PL1234567890')
check('youtube link', youtube.service === 'youtube' && youtube.listId === 'PL1234567890', JSON.stringify(youtube))
const soundcloud = await detectImportUrl('https://soundcloud.com/artist/sets/album')
check('soundcloud link', soundcloud.service === 'soundcloud', JSON.stringify(soundcloud))

try {
  await detectImportUrl('https://example.com/playlist/1')
  check('rejects unsupported links', false, 'accepted')
} catch (err) {
  check('rejects unsupported links', err instanceof Error && /Paste a playlist/.test(err.message), err instanceof Error ? err.message : String(err))
}

try {
  await detectImportUrl('https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz')
  check('rejects spotify track links', false, 'accepted')
} catch (err) {
  check('rejects spotify track links', err instanceof Error && /playlist/i.test(err.message), err instanceof Error ? err.message : String(err))
}

console.log('\nimport adapters (live)\n')
const dz = await resolveDeezer('908622995')
check('deezer resolves a playlist', dz.service === 'deezer' && dz.tracks.length > 0, `${dz.title} · ${dz.tracks.length} tracks`)
check('deezer keeps track metadata', Boolean(dz.tracks[0]?.title && dz.tracks[0]?.durationSec), JSON.stringify(dz.tracks[0]))

const am = await resolveApple(
  'https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'
)
check('apple resolves a playlist', am.service === 'apple' && am.tracks.length > 0, `${am.title} · ${am.tracks.length} tracks`)
check('apple keeps duration and artist', Boolean(am.tracks[0]?.durationSec && am.tracks[0]?.artists.length), JSON.stringify(am.tracks[0]))

const yt = await resolveYoutube('PLU0CpsviHWH2GP5FsdgOLYJ9hMLtclNpz')
check('youtube follows continuations past 100', yt.tracks.length > 100, `${yt.tracks.length} tracks`)
check('youtube keeps video ids', /^[A-Za-z0-9_-]{11}$/.test(yt.tracks[0]?.sourceId ?? ''), yt.tracks[0]?.sourceId ?? 'missing')

const sc = await resolveSoundcloud('https://soundcloud.com/nam-nguy-n-257804509/sets/lofi-chill-vietnam')
check('soundcloud resolves a set', sc.service === 'soundcloud' && sc.tracks.length > 0, `${sc.title} · ${sc.tracks.length} tracks`)

console.log('\nmatcher\n')
const exact = await matchImport(source({ title: 'Dreams - 2004 Remaster', artists: ['Fleetwood Mac'], durationSec: 258 }), () => undefined, () => false, async () => [item()])
check('auto-matches exact title/artist/duration', exact[0]?.status === 'auto' && exact[0]?.candidate?.title === 'Dreams', JSON.stringify(exact[0]?.status))

const live = await matchImport(
  source({ title: 'Dreams (Live)', artists: ['Fleetwood Mac'], durationSec: 260 }),
  () => undefined,
  () => false,
  async () => [item(), item({ id: 'live1234567', title: 'Dreams - Live', durationSec: 261 })]
)
check(
  'prefers the matching live version',
  live[0]?.status === 'auto' && /Live/.test(live[0]?.candidate?.title ?? ''),
  `${live[0]?.status} · ${live[0]?.candidate?.title}`
)

const durationMismatch = await matchImport(
  source({ title: 'Dreams', artists: ['Fleetwood Mac'], durationSec: 200 }),
  () => undefined,
  () => false,
  async () => [item({ durationSec: 260 })]
)
check(
  'flags a large duration mismatch for review',
  durationMismatch[0]?.status === 'review',
  `${durationMismatch[0]?.status} · ${durationMismatch[0]?.score}`
)

const missing = await matchImport(
  source({ title: 'Totally Different Song', artists: ['Another Artist'], durationSec: 180 }),
  () => undefined,
  () => false,
  async () => [item()]
)
check('marks unrelated results missing', missing[0]?.status === 'missing', `${missing[0]?.status} · ${missing[0]?.score}`)

let searched = false
const ytExact = await matchImport(
  source({ title: 'Any Track', artists: ['Any Artist'], durationSec: 200, sourceId: 'abc12345678' }, 'youtube'),
  () => undefined,
  () => false,
  async () => {
    searched = true
    return []
  }
)
check(
  'youtube imports skip the search and stay exact',
  ytExact[0]?.status === 'auto' && ytExact[0]?.candidate?.id === 'abc12345678' && !searched,
  JSON.stringify(ytExact[0]?.candidate?.id)
)

let progress = { done: 0, total: 0 }
await matchImport(
  source({ title: 'Dreams', artists: ['Fleetwood Mac'], durationSec: 258 }),
  (done, total) => {
    progress = { done, total }
  },
  () => false,
  async () => [item()]
)
check('reports matching progress', progress.done === 1 && progress.total === 1, JSON.stringify(progress))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
