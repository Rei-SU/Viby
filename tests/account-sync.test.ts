/**
 * SyncEngine against a real HTTP server: first-sync ordering (pull before push),
 * push batches, rev-cursor pulls, last-writer-wins merges, tombstones,
 * idempotent repeats and the signed-out short circuit.
 *
 * The Supabase client is real; only its base URL points at a local PostgREST-ish
 * fake. No network, no Docker, no live project. Run:
 *   node tests/unit.mjs account-sync
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Playlist, Track } from '../src/shared/types'
import { auth } from '../src/main/account/auth'
import { SyncEngine } from '../src/main/account/sync'
import { outboxStore } from '../src/main/account/outbox'
import { setRemoteLibrarySink } from '../src/main/account/records'
import { libraryPathFor } from '../src/main/account/library-root'
import { recoveryMarkerFor } from '../src/main/json-store'
import { lib, setActiveLibrary } from '../src/main/library'
import { setActiveSettings, settings, setSettings } from '../src/main/settings'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

process.env.VIBY_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'viby-sync-'))

type Row = {
  user_id: string
  kind: string
  record_id: string
  payload: unknown
  updated_at: number
  device_id: string
  deleted: boolean
  rev: number
}

const rows = new Map<string, Row>()
const requests: Array<{ method: string; path: string; body: unknown }> = []
let rev = 0
let activeUser = 'user-1'
let failNextPull = false
let failNextReconcile = false
let omitNextWinner = false

const rowKey = (userId: string, kind: string, recordId: string): string =>
  `${userId}\u0000${kind}\u0000${recordId}`

/** The same order as `sync_push`: updated_at, then device_id, then tombstone. */
function beats(a: Omit<Row, 'rev'>, b: Row): boolean {
  if (a.updated_at !== b.updated_at) return a.updated_at > b.updated_at
  if (a.device_id !== b.device_id) return a.device_id > b.device_id
  return a.deleted && !b.deleted
}

function addRemote(row: Omit<Row, 'rev' | 'user_id'>, userId = activeUser): void {
  rev += 1
  rows.set(rowKey(userId, row.kind, row.record_id), { ...row, user_id: userId, rev })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

async function body(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? JSON.parse(raw) : null
}

const server = http.createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parsed = req.method === 'POST' ? await body(req) : null
    requests.push({ method: req.method ?? 'GET', path: url.pathname, body: parsed })

    if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/sync_push') {
      const input = (parsed as { p_records?: unknown[] } | null)?.p_records
      const list = Array.isArray(input) ? input : []
      const out: Array<{ kind: string; record_id: string; rev: number }> = []
      for (const raw of list) {
        const item = raw as {
          kind: string
          record_id: string
          payload: unknown
          updated_at: number
          device_id: string
          deleted: boolean
        }
        const key = rowKey(activeUser, item.kind, item.record_id)
        const existing = rows.get(key)
        const candidate: Omit<Row, 'rev'> = {
          user_id: activeUser,
          kind: item.kind,
          record_id: item.record_id,
          payload: item.payload,
          updated_at: item.updated_at,
          device_id: item.device_id,
          deleted: item.deleted
        }
        if (!existing || beats(candidate, existing)) {
          rev += 1
          rows.set(key, { ...candidate, rev })
          out.push({ kind: item.kind, record_id: item.record_id, rev })
        }
        // A write that lost is not returned; the client treats a missing row
        // as a conflict and pulls the winner.
      }
      return send(res, 200, out)
    }

    if (req.method === 'GET' && url.pathname === '/rest/v1/sync_records') {
      const exact = url.searchParams.get('record_id')
      if (exact && failNextReconcile) {
        failNextReconcile = false
        return send(res, 500, { message: 'winner unavailable' })
      }
      if (exact && omitNextWinner) {
        omitNextWinner = false
        return send(res, 200, [])
      }
      if (failNextPull) {
        failNextPull = false
        return send(res, 500, { message: 'server exploded', code: 'XX000' })
      }
      const userId = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '')
      const rawCursor = url.searchParams.get('rev') ?? ''
      const cursor = Number(rawCursor.replace(/^gt\./, '')) || 0
      const limit = Number(url.searchParams.get('limit') ?? 500) || 500
      const kind = url.searchParams.get('kind')?.replace(/^eq\./, '')
      const ids = exact?.slice(4, -1).split(',')
      const list = [...rows.values()]
        .filter((row) => row.user_id === userId && row.rev > cursor)
        .filter((row) => (!kind || row.kind === kind) && (!ids || ids.includes(row.record_id)))
        .sort((a, b) => a.rev - b.rev)
        .slice(0, limit)
      return send(res, 200, list)
    }

    send(res, 404, { message: `no route for ${req.method} ${url.pathname}` })
  })().catch((error) => {
    send(res, 500, { message: String(error) })
  })
})

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as AddressInfo).port
const client: SupabaseClient = createClient(`http://127.0.0.1:${port}`, 'test-publishable-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
})
const manager = auth()
;(manager as unknown as { clientInstance: () => SupabaseClient }).clientInstance = () => client

const track = (id: string, title = id): Track => ({ id, title, artist: 'Artist', durationSec: 180 })

// Seed the local stores before the account is attached.
lib().toggleFavorite(track('sync-a', 'A'))
lib().toggleFavorite(track('sync-b', 'B'))
const playlist: Playlist = lib().createPlaylist('Sync list')
lib().addToPlaylist(playlist.id, track('sync-a', 'A'))
lib().toggleAlbum({ id: 'sync-alb', title: 'Sync album', savedAt: 1 })
lib().addHistory({ trackId: 'sync-h', title: 'H', artist: 'Artist', playedAt: 1234, completion: 0.9 })
setSettings({ audioQuality: 'data-saver', shuffle: true })

const postCount = (): number => requests.filter((entry) => entry.method === 'POST').length
const engine = new SyncEngine()
const statuses: string[] = []
const unsubscribe = engine.subscribe((status) => statuses.push(status.phase))

try {
  console.log('first sync: backfill then pull-before-push:')
  setActiveLibrary('user-1')
  engine.useAccount({ id: 'user-1' })
  const seeded = outboxStore().count()
  check('first sign-in backfills the local library', seeded >= 10, String(seeded))
  check('the status reports the backlog', engine.status().pending === seeded, String(engine.status().pending))

  await engine.now()
  check('the first request is a pull', requests[0]?.method === 'GET' && requests[0]?.path === '/rest/v1/sync_records', requests[0]?.path)
  check('the push follows the pull', requests[1]?.method === 'POST' && requests[1]?.path === '/rest/v1/rpc/sync_push', requests[1]?.path)

  const pushed = (requests[1]?.body as { p_records?: Array<{ kind: string; deleted: boolean }> } | undefined)?.p_records ?? []
  check('every seeded record was pushed', pushed.length === seeded, `${pushed.length}/${seeded}`)
  check('favourites travel', pushed.some((row) => row.kind === 'favorite'))
  check('playlists travel', pushed.some((row) => row.kind === 'playlist'))
  check('albums travel', pushed.some((row) => row.kind === 'album'))
  check('history travels', pushed.some((row) => row.kind === 'history'))
  check('settings travel', pushed.some((row) => row.kind === 'setting'))
  check('the push queue is drained', outboxStore().count() === 0)
  check('the engine reports idle', engine.status().phase === 'idle', engine.status().phase)
  check('the last sync is timestamped', (engine.status().lastSyncedAt ?? 0) > 0)
  check('the server holds one row per record', rows.size === seeded, `${rows.size}/${seeded}`)
  check('the first sync reported syncing then idle', statuses.includes('syncing') && statuses.at(-1) === 'idle')

  console.log('\npulling a remote change:')
  addRemote({
    kind: 'favorite',
    record_id: 'sync-remote',
    payload: track('sync-remote', 'Remote'),
    updated_at: Date.now() + 50_000,
    device_id: 'device-z',
    deleted: false
  })
  await engine.now()
  check('the remote favourite lands locally', lib().isFavorite('sync-remote'))
  check('it keeps its remote payload', lib().favorites().find((entry) => entry.id === 'sync-remote')?.title === 'Remote')

  console.log('\nlast writer wins on a conflict:')
  addRemote({
    kind: 'favorite',
    record_id: 'sync-remote',
    payload: track('sync-remote', 'Remote v2'),
    updated_at: Date.now() + 60_000,
    device_id: 'device-z',
    deleted: false
  })
  await engine.now()
  check('the newer remote copy replaces the local one', lib().favorites().find((entry) => entry.id === 'sync-remote')?.title === 'Remote v2')

  const before = { posts: postCount(), gets: requests.length }
  await engine.now()
  await engine.now()
  check('a repeat sync pushes nothing', postCount() === before.posts, `${before.posts} -> ${postCount()}`)
  check('a repeat sync is still idle', engine.status().phase === 'idle')
  check('nothing is left queued after repeats', outboxStore().count() === 0)
  check('repeats do not duplicate rows', rows.size === seeded + 1, `${rows.size}`)

  console.log('\nconflicts are reported:')
  lib().toggleFavorite(track('sync-conflict', 'Local edit'))
  engine.noteLocalChange()
  addRemote({
    kind: 'favorite',
    record_id: 'sync-conflict',
    payload: track('sync-conflict', 'Remote edit'),
    updated_at: Date.now() + 120_000,
    device_id: 'device-z',
    deleted: false
  })
  await engine.now()
  check(
    'the newer remote copy wins',
    lib().favorites().find((entry) => entry.id === 'sync-conflict')?.title === 'Remote edit'
  )
  check(
    'the replaced local edit is reported',
    engine.status().conflicts >= 1,
    String(engine.status().conflicts)
  )
  engine.clearConflicts()
  check('clearing resets the replaced-change count', engine.status().conflicts === 0)

  console.log('\nlocal deletion becomes a tombstone:')
  lib().toggleFavorite(track('sync-b', 'B'))
  engine.noteLocalChange()
  await engine.now()
  const tombstonePost = requests
    .filter((entry) => entry.method === 'POST')
    .at(-1)?.body as { p_records?: Array<{ kind: string; record_id: string; deleted: boolean }> } | undefined
  const tombstone = tombstonePost?.p_records?.find((row) => row.record_id === 'sync-b')
  check('the deletion is pushed as a tombstone', tombstone?.kind === 'favorite' && tombstone?.deleted === true)
  const storedB = [...rows.values()].find((row) => row.record_id === 'sync-b')
  check('the server marks the row deleted', storedB?.deleted === true)
  check('the local copy stays deleted', !lib().isFavorite('sync-b'))
  check('the tombstone drains from the outbox', outboxStore().count() === 0)

  const settled = postCount()
  await engine.now()
  check('the tombstone is not pushed twice', postCount() === settled)

  console.log('\nsigned out makes no call:')
  engine.useAccount(null)
  check('signed out reports idle', engine.status().phase === 'idle')
  const idle = requests.length
  await engine.now()
  check('no request goes out while signed out', requests.length === idle)
  check('the outbox is untouched while signed out', outboxStore().count() === 0)

  console.log('\nserver errors are reported, then recovered:')
  activeUser = 'user-2'
  setActiveLibrary('user-2')
  engine.useAccount({ id: 'user-2' })
  // A second account has its own library root, so it starts without the first
  // account's backlog; only its own edits travel.
  check('a second account starts without a backlog', outboxStore().count() === 0, String(outboxStore().count()))
  lib().toggleFavorite(track('sync-c', 'C'))
  engine.noteLocalChange()
  failNextPull = true
  await engine.now()
  check('a failed pull reports an error phase', engine.status().phase === 'error', engine.status().phase)
  check('the error text is surfaced', engine.status().error === 'server exploded', String(engine.status().error))
  check('the backlog is kept for a retry', engine.status().pending > 0, String(engine.status().pending))

  await engine.now()
  check('the next attempt recovers', engine.status().phase === 'idle', engine.status().phase)
  check('the second account is synced', outboxStore().count() === 0)
  check('the second account has its own rows', [...rows.values()].some((row) => row.user_id === 'user-2' && row.record_id === 'sync-c'))
  check('the first account rows are untouched', [...rows.values()].some((row) => row.user_id === 'user-1' && row.record_id === 'sync-remote'))

  console.log('\nreconciliation keeps rejected writes until the exact winner is available:')
  lib().toggleFavorite(track('sync-c'))
  engine.noteLocalChange()
  addRemote({
    kind: 'favorite', record_id: 'sync-c', payload: track('sync-c', 'Remote winner'),
    updated_at: Date.now() + 10_000, device_id: 'remote', deleted: false
  })
  failNextReconcile = true
  await engine.now()
  check('a failed winner request leaves the write queued', engine.status().pending === 1)
  omitNextWinner = true
  await engine.now()
  check('a missing exact match leaves the write queued', engine.status().pending === 1)
  await engine.now()
  check('a successful exact lookup clears the rejected write', engine.status().pending === 0)
  check('the winner replaces the rejected edit', lib().favorites()[0]?.title === 'Remote winner')

  console.log('\ncorruption marker survives restart and rebuilds the library:')
  lib().toggleFavorite(track('unsynced'))
  engine.noteLocalChange()
  const file = libraryPathFor('user-2')
  engine.useAccount(null)
  setActiveLibrary(null)
  writeFileSync(file, '{corrupt')
  setActiveLibrary('user-2')
  check('failed parse creates a persistent recovery marker', lib().loadFailed && existsSync(recoveryMarkerFor(file)))
  setActiveLibrary(null)
  setActiveLibrary('user-2')
  check('a new instance still knows the library needs recovery', lib().loadFailed)
  engine.useAccount({ id: 'user-2' })
  failNextPull = true
  await engine.now()
  check('an interrupted restore keeps the recovery marker and queue', lib().loadFailed && engine.status().pending === 1)
  let downloadUpdates = 0
  setRemoteLibrarySink(() => { downloadUpdates++ })
  await engine.now()
  setRemoteLibrarySink(null)
  check('an incomplete library never reconciles local download ownership', downloadUpdates === 0)
  check('the full pull restores previously synced tracks', lib().isFavorite('sync-c'))
  check('the previous durable local edit is restored and pushed', lib().isFavorite('unsynced') &&
    rows.get(rowKey('user-2', 'favorite', 'unsynced'))?.deleted === false)
  check('recovery clears the marker only after the pull finishes', !lib().loadFailed && !existsSync(recoveryMarkerFor(file)))
  await engine.now()
  check('restored records are not tombstoned', rows.get(rowKey('user-2', 'favorite', 'sync-c'))?.deleted === false)

  console.log('\nfull replay keeps playlist entries that arrive before their metadata:')
  engine.useAccount(null)
  activeUser = 'user-3'
  setActiveLibrary(activeUser)
  const stamp = Date.now()
  addRemote({
    kind: 'playlist_track', record_id: 'playlist-new:entry',
    payload: { playlistId: 'playlist-new', track: track('entry'), position: 0 },
    updated_at: stamp, device_id: 'remote', deleted: false
  })
  for (let index = 0; index < 499; index++) {
    addRemote({
      kind: 'setting', record_id: `other-setting-${index}`, payload: { value: false },
      updated_at: stamp, device_id: 'remote', deleted: false
    })
  }
  addRemote({
    kind: 'playlist', record_id: 'playlist-new',
    payload: { id: 'playlist-new', name: 'Restored list', createdAt: stamp, updatedAt: stamp },
    updated_at: stamp, device_id: 'remote', deleted: false
  })
  engine.useAccount({ id: activeUser })
  await engine.now()
  check('an item on the first page survives until its playlist on the second page',
    lib().playlist('playlist-new')?.tracks[0]?.id === 'entry')

  console.log('\naccount preferences migrate with their own queued edits:')
  engine.useAccount(null)
  activeUser = 'user-4'
  setActiveLibrary(activeUser)
  setActiveSettings(activeUser)
  engine.useAccount({ id: activeUser })
  const setting = {
    kind: 'setting' as const, recordId: 'repeat', payload: { value: 'one' },
    updatedAt: Date.now(), deviceId: 'local', deleted: false
  }
  outboxStore().put(setting)
  addRemote({
    kind: 'setting', record_id: 'repeat', payload: { value: 'off' },
    updated_at: setting.updatedAt - 100, device_id: 'remote', deleted: false
  })
  await engine.now()
  await engine.now()
  check('the newer queued preference survives both hydration and the next diff',
    settings().get().repeat === 'one' &&
    (rows.get(rowKey(activeUser, 'setting', 'repeat'))?.payload as { value?: string })?.value === 'one')
} finally {
  unsubscribe()
  engine.dispose()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
