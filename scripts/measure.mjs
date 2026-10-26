#!/usr/bin/env node
/**
 * Resource measurement on the packaged app (not the dev build).
 *
 *   npm run dist:dir
 *   node scripts/measure.mjs
 *
 * macOS-only for now: it reads `ps` RSS/cputime for the Electron process tree
 * and sums RSS across processes (shared pages are counted once per process, so
 * the total is an upper bound, matching the process-list method in PLAN §6).
 *
 * CPU is accumulated per PID between samples. Summing `cputime` across the tree
 * before and after would go negative when a helper exits mid-sample; per-PID
 * deltas count the work a process did while it was alive.
 *
 * The display is kept awake for the whole run. macOS sleeps it after a couple of
 * idle minutes; a sleeping or occluded display throttles the renderer and lets
 * the system purge its surfaces, which makes CPU and RSS incomparable.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const ROOT = process.cwd()
const APP = join(ROOT, 'dist', 'mac', 'Viby.app')
const BINARY = join(APP, 'Contents', 'MacOS', 'Viby')
const DEBUG_PORT = 9222
const BASE = `http://127.0.0.1:${DEBUG_PORT}`

if (!existsSync(BINARY)) {
  console.error('No packaged app. Run `npm run dist:dir` first.')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mb = (kb) => kb / 1024

// Wake the display now, then keep it (and the system) awake for the whole run.
// Without this, the default 2-minute display sleep turns the app into a
// throttled background renderer halfway through the sample.
try {
  execFileSync('caffeinate', ['-u', '-t', '1'], { stdio: 'ignore' })
} catch {}
const caffeinate = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' })

function cpuSeconds(value) {
  const parts = value.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0]
}

function readProcesses() {
  const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,cputime=,command='], {
    maxBuffer: 32 * 1024 * 1024
  }).toString()

  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)
      if (!m) return null
      return { pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), cputime: m[4], command: m[5] }
    })
    .filter(Boolean)
}

function snapshot(mainPid) {
  const all = readProcesses()
  const ids = new Set([mainPid])
  let grew = true
  while (grew) {
    grew = false
    for (const p of all) {
      if (ids.has(p.ppid) && !ids.has(p.pid)) {
        ids.add(p.pid)
        grew = true
      }
    }
  }

  const procs = all.filter((p) => ids.has(p.pid))
  return {
    procs,
    rssKb: procs.reduce((sum, p) => sum + p.rssKb, 0)
  }
}

function roleOf(command) {
  const type = command.match(/--type=([a-z-]+)/)?.[1]
  if (type === 'renderer') return 'renderer'
  if (type === 'gpu-process') return 'gpu'
  if (type === 'utility') return 'utility'
  if (type) return type
  if (command.includes('MacOS/Viby')) return 'main'
  return 'helper'
}

function describe(procs) {
  return procs
    .map((p) => {
      const role =
        p.command.match(/--type=([a-z-]+)/)?.[1] ??
        (p.command.includes('MacOS/Viby') ? 'main' : 'helper')
      return `${role}:${Math.round(mb(p.rssKb))}MB`
    })
    .join('  ')
}

async function sample(mainPid, label, seconds) {
  const before = snapshot(mainPid)
  let previous = new Map(
    before.procs.map((p) => [p.pid, { cpu: cpuSeconds(p.cputime), role: roleOf(p.command) }])
  )
  const started = Date.now()
  const rss = [before.rssKb]
  const cpuByRole = new Map()
  let cpuSec = 0

  while (Date.now() - started < seconds * 1000) {
    await sleep(2000)
    const current = snapshot(mainPid)
    rss.push(current.rssKb)

    const next = new Map()
    for (const p of current.procs) {
      const cpu = cpuSeconds(p.cputime)
      const role = roleOf(p.command)
      const prev = previous.get(p.pid)
      // A process that started after the previous tick has no baseline yet;
      // its first interval is deliberately not attributed to this sample.
      if (prev) {
        const delta = Math.max(0, cpu - prev.cpu)
        cpuSec += delta
        cpuByRole.set(prev.role, (cpuByRole.get(prev.role) ?? 0) + delta)
      }
      next.set(p.pid, { cpu, role })
    }
    previous = next
  }

  const after = snapshot(mainPid)
  const wall = (Date.now() - started) / 1000
  const cpuPct = (cpuSec / wall) * 100

  const cpuLine = [...cpuByRole.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, sec]) => `${role} ${((sec / wall) * 100).toFixed(1)}%`)
    .join(' · ')
  const avg = rss.reduce((a, b) => a + b, 0) / rss.length
  const min = Math.min(...rss)
  const max = Math.max(...rss)

  console.log(
    `${label.padEnd(22)} RSS ${mb(avg).toFixed(0).padStart(4)} MB avg ` +
      `(min ${mb(min).toFixed(0)}, max ${mb(max).toFixed(0)}) · CPU ${cpuPct.toFixed(2)}%`
  )
  console.log(`  ${describe(after.procs)}`)
  console.log(`  cpu by process: ${cpuLine}`)

  return { label, avgKb: avg, minKb: min, maxKb: max, cpuPct }
}

async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  const evaluate = async (expression) => {
    const result = await new Promise((resolve) => {
      const request = ++id
      pending.set(request, resolve)
      ws.send(
        JSON.stringify({
          id: request,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true, userGesture: true }
        })
      )
    })
    return result.result?.result?.value
  }

  return { ws, evaluate }
}

async function launch() {
  const t0 = Date.now()
  const child = spawn(BINARY, ['--mute-audio', `--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  child.stderr.on('data', () => {})

  let page = null
  let pageMs = 0
  while (Date.now() - t0 < 20_000) {
    try {
      const list = await (await fetch(`${BASE}/json/list`)).json()
      page = list.find((t) => t.type === 'page')
      if (page) {
        pageMs = Date.now() - t0
        break
      }
    } catch {}
    await sleep(40)
  }
  if (!page) throw new Error('CDP page never appeared')

  const { ws, evaluate } = await connect(page)

  let shellReady = 0
  let cardsReady = 0
  while (Date.now() - t0 < 20_000) {
    const state = await evaluate(
      `({ shell: Boolean(document.querySelector('.sidebar')), cards: document.querySelectorAll('.card').length })`
    )
    if (state?.shell && !shellReady) shellReady = Date.now() - t0
    if (state?.cards > 0) {
      cardsReady = Date.now() - t0
      if (shellReady) break
    }
    await sleep(50)
  }

  return { child, ws, evaluate, pageMs, shellMs: shellReady, cardsMs: cardsReady }
}

async function quit(child) {
  child.kill('SIGTERM')
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), sleep(5000)])
  await sleep(1200)
}

/**
 * Bring the window to the front. macOS throttles an occluded/background window,
 * so CPU measured behind Terminal is not comparable to the numbers in PLAN §6.
 */
function activate() {
  try {
    execFileSync('osascript', ['-e', 'tell application id "com.viby.app" to activate'], {
      stdio: 'ignore'
    })
  } catch {
    console.log('  (could not activate Viby; CPU may be throttled behind another window)')
  }
}

function bundleReport() {
  const dir = join(ROOT, 'out', 'renderer', 'assets')
  const files = readdirSync(dir).filter((f) => /\.(js|css)$/.test(f))
  let raw = 0
  let gz = 0
  for (const file of files) {
    const buf = readFileSync(join(dir, file))
    const gzipped = gzipSync(buf, { level: 9 }).byteLength
    raw += buf.byteLength
    gz += gzipped
    console.log(
      `  ${file}  ${(buf.byteLength / 1024).toFixed(0)} KB raw · ${(gzipped / 1024).toFixed(0)} KB gzip`
    )
  }
  console.log(
    `  total: ${(raw / 1024).toFixed(0)} KB raw · ${(gz / 1024).toFixed(0)} KB gzip`
  )
}

const quick = process.argv.includes('--quick')
const startups = []
let app = null

// Never leave caffeinate (or a half-measured app) behind, including when the
// playback guard below throws.
process.on('exit', () => {
  caffeinate.kill()
  app?.child?.kill('SIGTERM')
})

console.log(quick ? 'startup (1 launch, quick mode)\n' : 'startup (3 launches)\n')
for (let i = 0; i < (quick ? 1 : 3); i++) {
  if (app) await quit(app.child)
  app = await launch()
  startups.push(app)
  console.log(
    `  run ${i + 1}: page ${app.pageMs}ms · shell ${app.shellMs}ms · home cards ${app.cardsMs}ms`
  )
}

const { child, evaluate } = app
const mainPid = child.pid

// Match the PLAN §6 method: sample idle 60s after load, once Home's artwork
// and shelf refreshes have finished. At 25s the tail of that work still shows
// up as several percent of CPU.
await sleep(60_000)
activate()
await sleep(1000)

console.log('\nresources\n')
const idle = await sample(mainPid, 'idle (Home)', 30)

const before = await evaluate(
  `({ title: document.querySelector('.dock .title')?.textContent?.trim() ?? null,
      button: document.querySelector('.dock .play')?.getAttribute('aria-label') ?? null })`
)
if (before.button !== 'Pause') {
  if (before.title && before.title !== 'Nothing playing') {
    await evaluate(`document.querySelector('.dock .play')?.click(); true`)
  } else {
    // Cards put the click target on a nested button; clicking the card shell
    // only navigates (or does nothing), so the old `.card` click never started
    // audio.
    await evaluate(
      `(document.querySelector('.card .card-hit') ?? document.querySelector('.card button'))?.click(); true`
    )
  }
}

let playing = false
for (let i = 0; i < 80; i++) {
  await sleep(250)
  playing = await evaluate(
    `document.querySelector('.dock .play')?.getAttribute('aria-label') === 'Pause'`
  )
  if (playing) break
}
const nowPlaying = await evaluate(
  `({ title: document.querySelector('.dock .title')?.textContent?.trim() ?? null,
      quality: document.querySelector('.dock .quality')?.textContent?.trim() ?? null })`
)
console.log(`playing: ${JSON.stringify(nowPlaying)} (${playing ? 'started' : 'DID NOT START'})\n`)
if (!playing) {
  throw new Error('playback did not start; refusing to report idle numbers as "playing"')
}

await sleep(3000)
activate()
const audio = await sample(mainPid, 'playing', 30)

activate()
await evaluate(`document.querySelector('button[aria-label="Lyrics"]')?.click(); true`)
await sleep(2500)
const withLyrics = await sample(mainPid, 'playing + lyrics', 20)

let soakRss = [snapshot(mainPid).rssKb]
if (!quick) {
  console.log('\nsoak (2 minutes while playing)\n')
  activate()
  const soakStarted = Date.now()
  let previous = new Map(
    snapshot(mainPid).procs.map((p) => [p.pid, cpuSeconds(p.cputime)])
  )
  let soakCpuSec = 0
  while (Date.now() - soakStarted < 120_000) {
    await sleep(5000)
    const current = snapshot(mainPid)
    soakRss.push(current.rssKb)
    const next = new Map()
    for (const p of current.procs) {
      const cpu = cpuSeconds(p.cputime)
      const prev = previous.get(p.pid)
      if (prev !== undefined) soakCpuSec += Math.max(0, cpu - prev)
      next.set(p.pid, cpu)
    }
    previous = next
  }
  const soakWall = (Date.now() - soakStarted) / 1000
  console.log(
    `  RSS ${mb(soakRss[0]).toFixed(0)} → ${mb(soakRss[soakRss.length - 1]).toFixed(0)} MB ` +
      `(min ${mb(Math.min(...soakRss)).toFixed(0)}, max ${mb(Math.max(...soakRss)).toFixed(0)}) · ` +
      `CPU ${((soakCpuSec / soakWall) * 100).toFixed(2)}%`
  )
} else {
  console.log('\nsoak skipped (quick mode)')
}

await evaluate(`document.querySelector('.dock .play')?.click(); true`)
activate()
await sleep(3000)
const paused = await sample(mainPid, 'paused after playback', 20)

console.log('\nrenderer bundle\n')
bundleReport()

console.log('\nsummary\n')
console.log(`  startup (page):   ${startups.map((s) => `${s.pageMs}ms`).join(' · ')}`)
console.log(`  startup (shell):  ${startups.map((s) => `${s.shellMs}ms`).join(' · ')}`)
console.log(`  startup (cards):  ${startups.map((s) => `${s.cardsMs}ms`).join(' · ')}`)
console.log(`  idle:             ${mb(idle.avgKb).toFixed(0)} MB · ${idle.cpuPct.toFixed(2)}% CPU`)
console.log(`  playing:          ${mb(audio.avgKb).toFixed(0)} MB · ${audio.cpuPct.toFixed(2)}% CPU`)
console.log(
  `  playing + lyrics: ${mb(withLyrics.avgKb).toFixed(0)} MB · ${withLyrics.cpuPct.toFixed(2)}% CPU`
)
console.log(
  `  paused after:     ${mb(paused.avgKb).toFixed(0)} MB · ${paused.cpuPct.toFixed(2)}% CPU`
)
if (!quick) {
  console.log(
    `  soak growth:      ${(mb(soakRss[soakRss.length - 1]) - mb(soakRss[0])).toFixed(0)} MB over 2 min`
  )
}

await quit(child)
process.exit(0)
