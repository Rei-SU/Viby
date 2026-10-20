export const description = 'Autoplay extends the queue with related radio tracks'

export async function run(app, check) {
  const result = await app.evaluate(
    `
    (async () => {
      const p = window.__viby.player
      if (!p.autoplay) p.toggleAutoplay()
      await p.playList([{ id: 'dQw4w9WgXcQ', kind: 'song', title: 'Seed', subtitle: 'Rick Astley' }], 0)
      await new Promise((r) => setTimeout(r, 3000))
      const before = p.queue.length
      p.seek(Math.max(1, p.duration - 2))

      let out = null
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        out = {
          index: p.index,
          queue: p.queue.length,
          title: p.current?.title,
          playing: p.playing
        }
        if (out.index > 0 && out.playing) break
      }
      return { before, ...out }
    })()
  `,
    { userGesture: true }
  )

  console.log('  ', JSON.stringify(result))
  check('autoplay extends the queue', result.queue > result.before, `${result.before} → ${result.queue}`)
  check('autoplay moves to a related track', result.index === 1 && result.title !== 'Seed', result.title)
  check('autoplay track is playing', result.playing === true)
}
