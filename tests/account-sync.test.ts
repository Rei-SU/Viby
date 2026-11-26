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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Playlist, Track } from '../src/shared/types'
import { auth } from '../src/main/account/auth'
import { SyncEngine } from '../src/main/account/sync'
import { outboxStore } from '../src/main/account/outbox'
import { lib } from '../src/main/library'
import { setSettings } from '../src/main/settings'

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
      if (failNextPull) {
        failNextPull = false
        return send(res, 500, { message: 'server exploded', code: 'XX000' })
      }
      const userId = (url.searchParams.get('user_id') ?? '').replace(/^eq\./, '')
      const rawCursor = url.searchParams.get('rev') ?? ''
      const cursor = Number(rawCursor.replace(/^gt\./, '')) || 0
      const limit = Number(url.searchParams.get('limit') ?? 500) || 500
      const list = [...rows.values()]
        .filter((row) => row.user_id === userId && row.rev > cursor)
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
const book = lib()
book.toggleFavorite(track('sync-a', 'A'))
book.toggleFavorite(track('sync-b', 'B'))
const playlist: Playlist = book.createPlaylist('Sync list')
book.addToPlaylist(playlist.id, track('sync-a', 'A'))
book.toggleAlbum({ id: 'sync-alb', title: 'Sync album', savedAt: 1 })
book.addHistory({ trackId: 'sync-h', title: 'H', artist: 'Artist', playedAt: 1234, completion: 0.9 })
setSettings({ audioQuality: 'data-saver', shuffle: true })

const postCount = (): number => requests.filter((entry) => entry.method === 'POST').length
const engine = new SyncEngine()
const statuses: string[] = []
const unsubscribe = engine.subscribe((status) => statuses.push(status.phase))

try {
  console.log('first sync: backfill then pull-before-push:')
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
  check('the remote favourite lands locally', book.isFavorite('sync-remote'))
  check('it keeps its remote payload', book.favorites().find((entry) => entry.id === 'sync-remote')?.title === 'Remote')

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
  check('the newer remote copy replaces the local one', book.favorites().find((entry) => entry.id === 'sync-remote')?.title === 'Remote v2')

  const before = { posts: postCount(), gets: requests.length }
  await engine.now()
  await engine.now()
  check('a repeat sync pushes nothing', postCount() === before.posts, `${before.posts} -> ${postCount()}`)
  check('a repeat sync is still idle', engine.status().phase === 'idle')
  check('nothing is left queued after repeats', outboxStore().count() === 0)
  check('repeats do not duplicate rows', rows.size === seeded + 1, `${rows.size}`)

  console.log('\nconflicts are reported:')
  book.toggleFavorite(track('sync-conflict', 'Local edit'))
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
    book.favorites().find((entry) => entry.id === 'sync-conflict')?.title === 'Remote edit'
  )
  check(
    'the replaced local edit is reported',
    engine.status().conflicts >= 1,
    String(engine.status().conflicts)
  )

  console.log('\nlocal deletion becomes a tombstone:')
  book.toggleFavorite(track('sync-b', 'B'))
  engine.noteLocalChange()
  await engine.now()
  const tombstonePost = requests
    .filter((entry) => entry.method === 'POST')
    .at(-1)?.body as { p_records?: Array<{ kind: string; record_id: string; deleted: boolean }> } | undefined
  const tombstone = tombstonePost?.p_records?.find((row) => row.record_id === 'sync-b')
  check('the deletion is pushed as a tombstone', tombstone?.kind === 'favorite' && tombstone?.deleted === true)
  const storedB = [...rows.values()].find((row) => row.record_id === 'sync-b')
  check('the server marks the row deleted', storedB?.deleted === true)
  check('the local copy stays deleted', !book.isFavorite('sync-b'))
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
  engine.useAccount({ id: 'user-2' })
  // A second account on the same install must not inherit the first account's
  // library or backlog; only its own edits travel.
  check('a second account starts without a backlog', outboxStore().count() === 0, String(outboxStore().count()))
  book.toggleFavorite(track('sync-c', 'C'))
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
} finally {
  unsubscribe()
  engine.dispose()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
