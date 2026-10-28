import { connect, sleep } from '../cdp.mjs'

export { sleep }

/**
 * Shared context for every scenario: a CDP connection, the settings captured
 * before we touch anything, and a helper that puts the app back how it was.
 */
export async function openApp() {
  const { evaluate, send, close } = await connect()

  // The dev app exposes its page before the renderer has mounted, so wait for
  // the handle every scenario drives instead of racing the first evaluation.
  let settings
  for (let attempt = 0; attempt < 60 && !settings; attempt++) {
    try {
      settings = await evaluate('window.__viby?.api?.settings.get()')
    } catch {
      // The page is still loading.
    }
    if (!settings) await sleep(250)
  }
  if (!settings) throw new Error('the app handle did not appear on the page')

  return {
    evaluate,
    send,
    close,
    settings,

    /** Scenarios play silently. */
    mute: () =>
      evaluate(
        `(() => { const p = window.__viby.player; p.setVolume(0); if (!p.muted) p.toggleMute(); return true })()`
      ),

    /** Between scenarios: silence, clear the queue, return to Home. */
    cleanup: () =>
      evaluate(`(async () => {
        const { player, nav, api } = window.__viby
        player.clearQueue()
        player.error = null
        nav.go('home')
        window.__viby.sidePanel?.close()
        // Synthetic titles used by the harness must never look like listening.
        await api.debug?.forgetHistory(['Track A', 'Track B', 'Seed', 'Resume test', 'Q1', 'Q2', 'Q3'])
        return true
      })()`),

    /** At the end: also restore the user's volume/mute. */
    restore: () =>
      evaluate(`(() => {
        const p = window.__viby.player
        p.clearQueue()
        p.error = null
        window.__viby.sidePanel?.close()
        if (${JSON.stringify(settings.muted)} === false && p.muted) p.toggleMute()
        p.setVolume(${JSON.stringify(settings.volume)})
        window.__viby.nav.go('home')
        return true
      })()`)
  }
}

export function makeCheck() {
  let failures = 0
  const check = (label, ok, detail = '') => {
    if (!ok) failures++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }
  return { check, failures: () => failures }
}
