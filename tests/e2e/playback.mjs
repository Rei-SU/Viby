import { sleep } from './lib.mjs'

export const description = 'Playback: start, seek a cached file, auto-advance, UI sync'

export async function run(app, check) {
  const started = await app.evaluate(
    `
    (async () => {
      const p = window.__viby.player
      await p.playList([
        { id: 'dQw4w9WgXcQ', kind: 'song', title: 'Track A', subtitle: 'artist a' },
        { id: 'kJQP7kiw5Fk', kind: 'song', title: 'Track B', subtitle: 'artist b' }
      ], 0)
      for (let i = 0; i < 16 && !p.playing; i++) await new Promise((r) => setTimeout(r, 500))
      return { title: p.current?.title, index: p.index, playing: p.playing }
    })()
  `,
    { userGesture: true }
  )
  console.log('  started:', JSON.stringify(started))
  check('first track starts playing', started.title === 'Track A' && started.playing, JSON.stringify(started))

  const before = await app.evaluate(`
    (() => {
      const p = window.__viby.player
      return { position: Math.round(p.position), url: p.stream?.url, diag: p.diagnostics }
    })()
  `)

  await app.evaluate(`(() => { window.__viby.player.seek(60); return true })()`)
  await sleep(2500)

  const after = await app.evaluate(`
    (() => {
      const p = window.__viby.player
      return {
        position: Math.round(p.position),
        sameStream: p.stream?.url === ${JSON.stringify(before.url)},
        diag: p.diagnostics,
        playing: p.playing
      }
    })()
  `)
  console.log('  seek:', JSON.stringify({ from: before.position, to: after.position, ...after.diag }))

  check('seeking moves to the requested time', Math.abs(after.position - 60) <= 6, `${after.position}s`)
  check('seeking does not re-resolve the stream', after.sameStream === true)
  check('seeking does not restart from zero', after.position > 5, `${after.position}s`)
  check('seeking raises no media error', after.diag.errorCode === null, `code=${after.diag.errorCode}`)
  check('stream is seekable', (after.diag.seekable?.[0]?.[1] ?? 0) > 30, JSON.stringify(after.diag.seekable))

  // Let it end naturally, then poll: seeking near the end can stall on the tail.
  await app.evaluate(`(() => { const p = window.__viby.player; p.seek(Math.max(1, p.duration - 3)); return true })()`)

  let ended = null
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(1000)
    ended = await app.evaluate(`
      (() => {
        const p = window.__viby.player
        return {
          title: p.current?.title,
          index: p.index,
          playing: p.playing,
          domTitle: document.querySelector('.dock .title')?.textContent?.trim(),
          domButton: document.querySelector('.dock .play')?.getAttribute('aria-label')
        }
      })()
    `)
    if (ended.index === 1) break
  }
  console.log('  after end:', JSON.stringify(ended))

  check('advanced to the next track', ended.index > started.index, `index ${started.index} -> ${ended.index}`)
  check('next track is playing', ended.playing === true)
  check('player bar shows the playing track', ended.domTitle === ended.title, `dom="${ended.domTitle}"`)
  check('play button shows pause', ended.domButton === 'Pause', `button="${ended.domButton}"`)

  const quality = await app.evaluate(`document.querySelector('.dock .quality')?.textContent?.trim() ?? null`)
  check(
    'quality tag shows codec and bitrate',
    typeof quality === 'string' && /^[A-Z]+ \d+k$/.test(quality),
    `tag="${quality}"`
  )
}
