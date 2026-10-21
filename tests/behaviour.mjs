/**
 * Player behaviour sweep against the real app: queue editing, repeat modes,
 * shuffle, favourites, history and the OS media session.
 *
 *   VIBY_DEBUG_PORT=9222 npm run dev
 *   node tests/behaviour.mjs
 *
 * Don't use the app while this runs — it owns the queue. It plays silently
 * (volume 0), restores your settings afterwards, and cleans up the synthetic
 * history entries it creates.
 */
import { connect, sleep } from './cdp.mjs'

const { evaluate, close } = await connect()

let failures = 0
function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

const SAVED = await evaluate(`
  (async () => {
    const s = await window.__viby.api.settings.get()
    window.__saved = s
    window.__viby.player.setVolume(0)
    if (!window.__viby.player.muted) window.__viby.player.toggleMute()
    return s
  })()
`)
console.log('saved settings:', JSON.stringify(SAVED))

const TRACKS = [
  { id: 'dQw4w9WgXcQ', kind: 'song', title: 'Q1', subtitle: 'a' },
  { id: 'kJQP7kiw5Fk', kind: 'song', title: 'Q2', subtitle: 'b' },
  { id: 'JGwWNGJdvx8', kind: 'song', title: 'Q3', subtitle: 'c' }
]

async function state() {
  return evaluate(`
    (() => {
      const p = window.__viby.player
      return {
        title: p.current?.title ?? null,
        index: p.index,
        length: p.queue.length,
        playing: p.playing,
        position: Math.round(p.position),
        duration: Math.round(p.duration),
        repeat: p.repeat,
        shuffle: p.shuffle,
        streamCached: p.stream?.cached === true,
        streamUrl: p.stream?.url?.slice(0, 12) ?? null
      }
    })()
  `)
}

async function playQueue(items, index = 0) {
  await evaluate(
    `(async () => { await window.__viby.player.playList(${JSON.stringify(items)}, ${index}); return true })()`,
    { userGesture: true }
  )
  await sleep(500)
}

async function waitFor(predicate, { attempts = 25 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const s = await state()
    if (predicate(s)) return s
    await sleep(1000)
  }
  return state()
}

// ---- queue editing ---------------------------------------------------------
console.log('\nqueue:')
await playQueue(TRACKS, 0)
let s = await waitFor((x) => x.title === 'Q1' && x.playing)
check('plays the first of three', s.title === 'Q1' && s.length === 3, JSON.stringify(s))

await evaluate(`(() => { window.__viby.player.removeAt(1); return true })()`)
s = await state()
check('removing a later track keeps the current one', s.title === 'Q1' && s.length === 2, JSON.stringify(s))

await evaluate(`(() => { window.__viby.player.removeAt(0); return true })()`)
s = await waitFor((x) => x.title === 'Q3' && x.playing)
check('removing the current track advances', s.title === 'Q3' && s.length === 1 && s.playing, JSON.stringify(s))

await evaluate(`(() => { window.__viby.player.clearQueue(); return true })()`)
s = await state()
check('clear empties the queue and stops', s.title === null && s.length === 0 && !s.playing, JSON.stringify(s))

// ---- repeat one ------------------------------------------------------------
console.log('\nrepeat one:')
await playQueue(TRACKS.slice(0, 2), 0)
await evaluate(`(() => { const p = window.__viby.player; while (p.repeat !== 'one') p.cycleRepeat(); return p.repeat })()`)
await evaluate(`(() => { const p = window.__viby.player; p.seek(Math.max(1, p.duration - 2)); return true })()`)
s = await waitFor((x) => x.title === 'Q1' && x.position <= 4 && x.playing, { attempts: 30 })
check('repeat one restarts the same track', s.title === 'Q1' && s.index === 0 && s.position <= 6 && s.playing, JSON.stringify(s))
await evaluate(`(() => { const p = window.__viby.player; while (p.repeat !== 'off') p.cycleRepeat(); return p.repeat })()`)

// ---- repeat all ------------------------------------------------------------
console.log('\nrepeat all:')
await playQueue(TRACKS.slice(0, 2), 1)
await evaluate(`(() => { const p = window.__viby.player; while (p.repeat !== 'all') p.cycleRepeat(); return p.repeat })()`)
check('starts on the last track', (await state()).title === 'Q2')
await evaluate(`(() => { const p = window.__viby.player; p.seek(Math.max(1, p.duration - 2)); return true })()`)
s = await waitFor((x) => x.title === 'Q1' && x.playing, { attempts: 30 })
check('repeat all wraps to the first track', s.title === 'Q1' && s.index === 0 && s.playing, JSON.stringify(s))
await evaluate(`(() => { const p = window.__viby.player; while (p.repeat !== 'off') p.cycleRepeat(); return p.repeat })()`)

// ---- shuffle ---------------------------------------------------------------
console.log('\nshuffle:')
await playQueue(TRACKS, 0)
await evaluate(`(() => { const p = window.__viby.player; if (!p.shuffle) p.toggleShuffle(); return p.shuffle })()`)
const visited = new Set()
let repeated = false
for (let i = 0; i < 8; i++) {
  await evaluate(`(() => { window.__viby.player.next(); return true })()`)
  await sleep(400)
  const x = await state()
  if (x.index < 0 || x.index >= x.length) repeated = true
  visited.add(x.title)
}
check('shuffle stays inside the queue', !repeated)
check('shuffle visits more than one track', visited.size > 1, [...visited].join(','))
await evaluate(`(() => { const p = window.__viby.player; if (p.shuffle) p.toggleShuffle(); return p.shuffle })()`)

// ---- favourites ------------------------------------------------------------
console.log('\nfavourites:')
await playQueue([TRACKS[0]], 0)
await waitFor((x) => x.title === 'Q1' && x.playing)

// Use the real heart button so this covers the UI path, not just the API.
const favClick = await evaluate(
  `(async () => {
     const btn = document.querySelector('.dock .fav')
     if (!btn) return { clicked: false }
     btn.click()
     await new Promise((r) => setTimeout(r, 400))
     const list = await window.__viby.api.favorites.list()
     return {
       clicked: true,
       on: btn.classList.contains('on'),
       saved: list.some((t) => t.id === window.__viby.player.current.id),
       count: list.length
     }
   })()`
)
check('heart button favourites the track', favClick.clicked && favClick.saved, JSON.stringify(favClick))
check('heart turns on', favClick.on === true, JSON.stringify(favClick))

const favOff = await evaluate(
  `(async () => {
     const btn = document.querySelector('.dock .fav')
     btn.click()
     await new Promise((r) => setTimeout(r, 400))
     const list = await window.__viby.api.favorites.list()
     return { on: btn.classList.contains('on'), saved: list.some((t) => t.id === window.__viby.player.current.id) }
   })()`
)
check('heart button unfavourites', favOff.on === false && favOff.saved === false, JSON.stringify(favOff))

// ---- history ---------------------------------------------------------------
console.log('\nhistory:')
const historyBefore = (await evaluate(`window.__viby.api.history.list(500).then((h) => h.length)`))
const recorded = await evaluate(
  `(async () => {
     const { api, player } = window.__viby
     player.toggle() // pause -> records
     await new Promise((r) => setTimeout(r, 300))
     const list = await api.history.list(500)
     return { length: list.length, top: list[0] }
   })()`
)
check('pausing records history', recorded.length === historyBefore + 1, `${historyBefore} -> ${recorded.length}`)
check('history entry has the track', recorded.top?.trackId === 'dQw4w9WgXcQ', JSON.stringify(recorded.top))

// ---- media session ---------------------------------------------------------
console.log('\nmedia session:')
const media = await evaluate(
  `(() => ({
     title: navigator.mediaSession.metadata?.title ?? null,
     artist: navigator.mediaSession.metadata?.artist ?? null,
     state: navigator.mediaSession.playbackState,
     art: navigator.mediaSession.metadata?.artwork?.length ?? 0
   }))()`
)
check('media session metadata matches the track', media.title === 'Q1', JSON.stringify(media))
check('artwork is published to the OS', media.art > 0, `artwork=${media.art}`)

// ---- restore ---------------------------------------------------------------
await evaluate(`
  (async () => {
    const { api, player } = window.__viby
    player.clearQueue()
    if (player.muted !== window.__saved.muted) player.toggleMute()
    player.setVolume(window.__saved.volume)
    if (player.shuffle !== window.__saved.shuffle) player.toggleShuffle()
    while (player.repeat !== window.__saved.repeat) player.cycleRepeat()
    await api.debug?.forgetHistory(['Q1', 'Q2', 'Q3'])
    await new Promise((r) => setTimeout(r, 500))
    return true
  })()
`)

close()
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
