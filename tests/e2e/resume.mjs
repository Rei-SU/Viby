import { sleep } from './lib.mjs'

export const description = 'Resume: relaunch restores the track and timestamp, paused'

export async function run(app, check) {
  const saved = await app.evaluate(
    `
    (async () => {
      const p = window.__viby.player
      await p.playList([{ id: 'kJQP7kiw5Fk', kind: 'song', title: 'Resume test', subtitle: 'Luis Fonsi', durationSec: 282 }], 0)
      await new Promise((r) => setTimeout(r, 3000))
      p.seek(75)
      await new Promise((r) => setTimeout(r, 3600))
      return { title: p.current?.title ?? null, position: Math.round(p.position) }
    })()
  `,
    { userGesture: true }
  )
  console.log('  saved at:', JSON.stringify(saved))

  await app.evaluate('location.reload(); true').catch(() => undefined)
  await sleep(6500)

  const restored = await app.evaluate(
    `
    (() => {
      const p = window.__viby.player
      return {
        title: p.current?.title ?? null,
        position: Math.round(p.position),
        playing: p.playing,
        queue: p.queue.length
      }
    })()
  `,
    { awaitPromise: false }
  ).catch((err) => ({ error: String(err) }))
  console.log('  restored:', JSON.stringify(restored))

  check('session restores the track', restored.title === 'Resume test', JSON.stringify(restored))
  check('session restores the timestamp', Math.abs((restored.position ?? 0) - 75) <= 6, JSON.stringify(restored))
  check('restored session starts paused', restored.playing === false, JSON.stringify(restored))

  const resumed = await app.evaluate(
    `
    (async () => {
      const p = window.__viby.player
      p.toggle()
      await new Promise((r) => setTimeout(r, 5000))
      return { playing: p.playing, position: Math.round(p.position) }
    })()
  `,
    { userGesture: true }
  )
  check('play resumes from the saved timestamp', resumed.playing === true && resumed.position >= 70, JSON.stringify(resumed))
}
