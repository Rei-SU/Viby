import { connect, sleep } from '../cdp.mjs'

export { sleep }

/**
 * Shared context for every scenario: a CDP connection, the settings captured
 * before we touch anything, and a helper that puts the app back how it was.
 */
export async function openApp() {
  const { evaluate, close } = await connect()
  const settings = await evaluate('window.__viby.api.settings.get()')

  return {
    evaluate,
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
