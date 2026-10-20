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
    rssKb: procs.reduce((sum, p) => sum + p.rssKb, 0),
    cpuSec: procs.reduce((sum, p) => sum + cpuSeconds(p.cputime), 0)
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
  const beforeCpu = new Map(
    before.procs.map((p) => [p.pid, { cpu: cpuSeconds(p.cputime), role: roleOf(p.command) }])
  )
  const started = Date.now()
  const rss = [before.rssKb]

  while (Date.now() - started < seconds * 1000) {
    await sleep(2000)
    rss.push(snapshot(mainPid).rssKb)
  }

  const after = snapshot(mainPid)
  const wall = (Date.now() - started) / 1000
  const cpuPct = ((after.cpuSec - before.cpuSec) / wall) * 100

  const byRole = new Map()
  for (const p of after.procs) {
    const prev = beforeCpu.get(p.pid)
    if (!prev) continue
    const delta = ((cpuSeconds(p.cputime) - prev.cpu) / wall) * 100
    byRole.set(prev.role, (byRole.get(prev.role) ?? 0) + delta)
  }
  const cpuLine = [...byRole.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([role, pct]) => `${role} ${pct.toFixed(1)}%`)
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

// Let artwork, shelves and fonts settle before counting idle memory.
await sleep(25_000)

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
    await evaluate(`document.querySelector('.card')?.click(); true`)
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

await sleep(3000)
const audio = await sample(mainPid, 'playing', 30)

await evaluate(`document.querySelector('button[aria-label="Lyrics"]')?.click(); true`)
await sleep(2500)
const withLyrics = await sample(mainPid, 'playing + lyrics', 20)

let soakRss = [snapshot(mainPid).rssKb]
if (!quick) {
  console.log('\nsoak (2 minutes while playing)\n')
  const soakStart = snapshot(mainPid)
  const soakStarted = Date.now()
  while (Date.now() - soakStarted < 120_000) {
    await sleep(5000)
    soakRss.push(snapshot(mainPid).rssKb)
  }
  const soakEnd = snapshot(mainPid)
  const soakWall = (Date.now() - soakStarted) / 1000
  console.log(
    `  RSS ${mb(soakRss[0]).toFixed(0)} → ${mb(soakRss[soakRss.length - 1]).toFixed(0)} MB ` +
      `(min ${mb(Math.min(...soakRss)).toFixed(0)}, max ${mb(Math.max(...soakRss)).toFixed(0)}) · ` +
      `CPU ${(((soakEnd.cpuSec - soakStart.cpuSec) / soakWall) * 100).toFixed(2)}%`
  )
} else {
  console.log('\nsoak skipped (quick mode)')
}

await evaluate(`document.querySelector('.dock .play')?.click(); true`)
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
