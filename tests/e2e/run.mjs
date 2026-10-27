import { makeCheck, openApp } from './lib.mjs'
import * as autoplay from './autoplay.mjs'
import * as home from './home.mjs'
import * as images from './images.mjs'
import * as importScenario from './import.mjs'
import * as library from './library.mjs'
import * as links from './links.mjs'
import * as lyrics from './lyrics.mjs'
import * as lyricsChange from './lyrics-change.mjs'
import * as navigation from './navigation.mjs'
import * as offline from './offline.mjs'
import * as playback from './playback.mjs'
import * as queue from './queue.mjs'
import * as quickSearch from './quick-search.mjs'
import * as reconnect from './reconnect.mjs'
import * as resume from './resume.mjs'
import * as settings from './settings.mjs'

/**
 * Runs e2e scenarios against the running app.
 *
 *   VIBY_DEBUG_PORT=9222 npm run dev
 *   node tests/e2e/run.mjs lyrics library     # only what you changed
 *   node tests/e2e/run.mjs                    # everything
 */
const scenarios = { images, home, playback, reconnect, autoplay, links, queue, lyrics, 'lyrics-change': lyricsChange, library, resume, navigation, offline, 'quick-search': quickSearch, settings, import: importScenario }

const requested = process.argv.slice(2)
const unknown = requested.filter((name) => !scenarios[name])

if (unknown.length > 0) {
  console.error(`Unknown scenario(s): ${unknown.join(', ')}`)
  console.error(`Available: ${Object.keys(scenarios).join(', ')}`)
  process.exit(2)
}

const selected = requested.length > 0 ? requested : Object.keys(scenarios)

const app = await openApp()
await app.mute()

let total = 0
for (const name of selected) {
  const scenario = scenarios[name]
  console.log(`\n▶ ${name}${scenario.description ? ` — ${scenario.description}` : ''}`)

  const { check, failures } = makeCheck()
  try {
    await scenario.run(app, check)
  } catch (err) {
    check(`${name} crashed`, false, err instanceof Error ? err.message : String(err))
  }
  total += failures()

  // Keep it silent between scenarios; restore the user's settings at the end.
  await app.cleanup().catch(() => undefined)
}

await app.restore().catch(() => undefined)
app.close()

console.log(`\n${total === 0 ? 'ALL CHECKS PASSED' : `${total} CHECK(S) FAILED`}`)
process.exit(total === 0 ? 0 : 1)
