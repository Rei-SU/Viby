/**
 * Live Spotify import regression: the anonymous web-player path must resolve a
 * public playlist beyond the embed's 100-track cap, without any credentials.
 * Run with:
 *
 *   node tests/unit.mjs spotify
 */
import { resolveSpotifyPlaylist, SpotifyImportError } from '../src/main/import/spotify'

let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  if (!condition) failures++
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('spotify anonymous import tests\n')

const started = Date.now()
const source = await resolveSpotifyPlaylist(
  'https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U?si=tracking'
)
const elapsed = Date.now() - started
const first = source.tracks[0]
const last = source.tracks[source.tracks.length - 1]

console.log(`  resolved in ${elapsed}ms: ${source.title} · ${source.totalTracks} tracks`)
console.log(`  first: ${first?.title} — ${first?.artists?.join(', ')} (${first?.durationSec}s, ${first?.album})`)
console.log(`  last:  ${last?.title} — ${last?.artists?.join(', ')}`)

check('detects the service and kind', source.service === 'spotify' && source.kind === 'playlist', `${source.service}/${source.kind}`)
check('reads the playlist title', source.title === 'Rock Classics', source.title)
check('reads the real total', source.totalTracks === 200, `${source.totalTracks}`)
check('paginates past the 100-track embed cap', source.tracks.length === 200, `${source.tracks.length}`)
check('keeps Spotify order', first?.title === 'Dreams - 2004 Remaster', first?.title ?? 'missing')
check('keeps structured artists', first?.artists?.includes('Fleetwood Mac') === true, JSON.stringify(first?.artists))
check('keeps duration', typeof first?.durationSec === 'number' && Math.abs(first.durationSec - 258) <= 1, `${first?.durationSec}s`)
check('keeps the album', /Rumours/.test(first?.album ?? ''), first?.album ?? 'missing')
check('keeps track ids', /^[A-Za-z0-9]{22}$/.test(first?.sourceId ?? ''), first?.sourceId ?? 'missing')
check('resolves in a reasonable time', elapsed < 20_000, `${elapsed}ms`)
check('has a cover', typeof source.cover === 'string' && source.cover.startsWith('https://'), source.cover?.slice(0, 40) ?? 'missing')

try {
  await resolveSpotifyPlaylist('https://open.spotify.com/track/0ofHAoxe9vBkTCp2UQIavz')
  check('rejects a non-playlist link', false, 'resolved anyway')
} catch (err) {
  check(
    'rejects a non-playlist link',
    err instanceof SpotifyImportError && /playlist/i.test(err.message),
    err instanceof Error ? err.message : String(err)
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
