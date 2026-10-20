import { sleep } from './lib.mjs'

export const description = 'Resume: a dead source shows the spinner and re-resolves instead of failing silently'

const TRACK = {
  id: 'NIma5XOxBq0',
  kind: 'song',
  title: 'Softcore',
  subtitle: 'The Neighbourhood',
  artists: ['The Neighbourhood'],
  durationSec: 206,
  videoType: 'audio'
}

export async function run(app, check) {
  try {
    const setup = await app.evaluate(
      `
      (async () => {
        const p = window.__viby.player
        await p.playList([${JSON.stringify(TRACK)}], 0)
        for (let i = 0; i < 40 && !p.playing; i++) await new Promise((r) => setTimeout(r, 250))
        await new Promise((r) => setTimeout(r, 1200))
        p.toggle() // pause, keeping the source loaded (the resume path)
        await new Promise((r) => setTimeout(r, 400))
        return { playing: p.playing, position: Math.round(p.position), loaded: Boolean(p.stream) }
      })()
    `,
      { userGesture: true }
    )
    check('track is paused with a loaded source', setup.playing === false && setup.loaded === true, JSON.stringify(setup))

    // Reject exactly the next play(), like an expired URL or a replaced cache
    // file failing immediately on resume. The recovery's play() is left intact.
    await app.evaluate(
      `(() => {
        const original = HTMLMediaElement.prototype.play
        let fired = false
        HTMLMediaElement.prototype.play = function () {
          if (!fired) {
            fired = true
            return Promise.reject(new DOMException('expired source', 'NotSupportedError'))
          }
          return original.call(this)
        }
        window.__restorePlay = () => { HTMLMediaElement.prototype.play = original }
        return true
      })()`,
      { userGesture: true }
    )

    await app.evaluate(`window.__viby.player.toggle(); true`, { userGesture: true })

    const states = await app.evaluate(`
      (async () => {
        const out = []
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 100))
          const p = window.__viby.player
          const button = document.querySelector('.dock .play')
          out.push({
            reconnecting: p.reconnecting,
            busy: p.busy,
            playing: p.playing,
            position: Math.round(p.position),
            loadingClass: button?.classList.contains('loading') ?? false,
            aria: button?.getAttribute('aria-label') ?? null,
            notice: document.querySelector('.notice')?.textContent?.trim() ?? null
          })
          if (p.playing && p.position > 0 && !p.reconnecting) break
        }
        return out
      })()
    `,
      { userGesture: true }
    )

    const sawReconnecting = states.some((s) => s.reconnecting === true)
    const sawSpinner = states.some((s) => s.loadingClass === true && s.aria === 'Loading')
    const final = states[states.length - 1]

    console.log('  states:', JSON.stringify(states.filter((_, i) => i % 5 === 0)))
    check('the failed resume shows the loading state', sawReconnecting && sawSpinner, `observed=${states.length}`)
    check(
      'playback recovers and resumes',
      final.playing === true && final.position > 0 && final.reconnecting === false,
      JSON.stringify(final)
    )
    check('no error is shown when recovery works', final.notice === null, final.notice ?? '')
  } finally {
    await app.evaluate(`window.__restorePlay?.(); true`).catch(() => undefined)
    await app.evaluate(
      `(() => { const p = window.__viby.player; if (p.playing) p.toggle(); return true })()`
    ).catch(() => undefined)
    await sleep(300)
  }
}
