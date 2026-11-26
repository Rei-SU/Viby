import { app } from 'electron'
import type { SyncConflict, SyncStatus } from '@shared/account'
import { JsonStore } from '../json-store'
import { networkMonitor } from '../network'
import { auth, publicError } from './auth'
import { compareVersions, isSyncKind, remoteWins } from './compare'
import { accountFile } from './library-root'
import { outboxKey, outboxStore, type OutboxRecord } from './outbox'
import { applyRemoteRecordsTracked, RecordTracker } from './records'

/**
 * Push/pull engine.
 *
 * It never runs for a signed-out user, never blocks playback and never waits on
 * a request during startup: a sync is always scheduled on a timer and failures
 * only change the reported status. The local JSON stores remain authoritative;
 * the server is a second copy that the next pull merges back through the
 * last-writer-wins comparator.
 */

const BATCH = 100
const PAGE = 500
const DEBOUNCE_MS = 2000
const STARTUP_DELAY_MS = 1500
const FOCUS_MIN_INTERVAL_MS = 30_000
/** Signed-in devices also check for remote changes on a slow timer. */
const PULL_INTERVAL_MS = 60_000
const PUSH_PAGES = 100
const PULL_PAGES = 200

type AccountRef = { id: string }

type ConflictEntry = { at: number; kind: string; recordId: string }
type ConflictData = { entries: ConflictEntry[] }

type CursorData = { userId: string; cursor: number; lastSyncedAt: number }

type SyncRow = {
  kind?: unknown
  record_id?: unknown
  payload?: unknown
  updated_at?: unknown
  device_id?: unknown
  deleted?: unknown
  rev?: unknown
}

function rowNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function rowToRecord(row: SyncRow): OutboxRecord | null {
  if (!row || typeof row !== 'object') return null
  if (!isSyncKind(row.kind)) return null
  if (typeof row.record_id !== 'string' || row.record_id.length === 0) return null
  const updatedAt = rowNumber(row.updated_at)
  if (updatedAt === null) return null
  if (typeof row.device_id !== 'string') return null
  if (typeof row.deleted !== 'boolean') return null
  return {
    kind: row.kind,
    recordId: row.record_id,
    payload: row.payload ?? null,
    updatedAt,
    deviceId: row.device_id,
    deleted: row.deleted
  }
}

function rowKey(row: SyncRow): string | null {
  if (!isSyncKind(row.kind) || typeof row.record_id !== 'string') return null
  return outboxKey({ kind: row.kind, recordId: row.record_id })
}

function describeError(error: unknown): string {
  const message = publicError(error)
  if (/could not find the function|schema cache|does not exist|PGRST202/i.test(message)) {
    return 'Sync is not set up on the server yet. Apply the sync migration first.'
  }
  return message
}

export class SyncEngine {
  private state: SyncStatus = {
    phase: 'idle',
    lastSyncedAt: null,
    pending: 0,
    conflicts: 0,
    error: null
  }
  private readonly listeners = new Set<(status: SyncStatus) => void>()
  private readonly tracker = new RecordTracker()
  private readonly outbox = outboxStore()
  private cursorStore: JsonStore<CursorData> | null = null
  private conflictStore: JsonStore<ConflictData> | null = null

  private user: AccountRef | null = null
  private cursor = 0
  private lastSyncedAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private current: Promise<void> | null = null
  private rerun = false
  private followUp = false
  private attemptAt = 0
  /** Deletions are only trusted after this account has been pulled once. */
  private pulled = false
  private backoff = 0

  status(): SyncStatus {
    return { ...this.state, pending: this.outbox.count() }
  }

  subscribe(callback: (status: SyncStatus) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  conflicts(): SyncConflict[] {
    return [...(this.conflictStore?.get().entries ?? [])]
  }

  clearConflicts(): void {
    this.conflictStore?.set({ entries: [] })
    this.publish({ conflicts: 0 })
  }

  private totalConflicts(): number {
    return this.conflictStore?.get().entries.length ?? 0
  }

  /** Bind to the signed-in account, or stop everything when null. */
  useAccount(account: AccountRef | null): void {
    if (this.user?.id === account?.id) return
    this.user = account
    this.rerun = false
    this.pulled = false
    this.backoff = 0
    this.conflictStore = account
      ? new JsonStore<ConflictData>(accountFile(account.id, 'conflicts.json'), { entries: [] })
      : null
    this.cursorStore = account
      ? new JsonStore<CursorData>(accountFile(account.id, 'sync-cursor.json'), {
          userId: account.id,
          cursor: 0,
          lastSyncedAt: 0
        })
      : null

    // The queue is per account. A different sign-in gets a different file, so
    // the previous user's pending writes and tombstones can never leak.
    this.outbox.useUser(account?.id ?? null)

    if (!account) {
      this.tracker.stop()
      this.clearTimer()
      this.cursor = 0
      this.lastSyncedAt = null
      this.publish({ phase: 'idle', lastSyncedAt: null, error: null, conflicts: 0 })
      return
    }

    // A first sign-in on this install may adopt the local library. The tracker
    // decides that: it only seeds when this library was never bound to another
    // account, so a second account on the same machine does not upload the
    // first account's favourites, playlists, history or settings.
    const seeded = this.tracker.begin(account.id)
    this.loadCursor(account.id)
    if (seeded.length > 0) this.outbox.putAll(seeded)
    this.publish({
      phase: 'idle',
      lastSyncedAt: this.lastSyncedAt,
      error: null,
      conflicts: this.totalConflicts()
    })
    this.schedule(STARTUP_DELAY_MS)
  }

  /** A local store changed. Coalesce for a moment, then sync. */
  noteLocalChange(): void {
    if (!this.user) return
    this.followUp = false
    this.flushLocal()
    this.schedule(DEBOUNCE_MS)
  }

  /** Window focus: catch up if this machine has been idle for a while. */
  nudge(): void {
    if (!this.user) return
    if (Date.now() - this.attemptAt < FOCUS_MIN_INTERVAL_MS) return
    this.followUp = false
    this.schedule(300)
  }

  /** Connectivity came back: retry a run that had failed. */
  resume(): void {
    if (!this.user) return
    if (this.state.phase !== 'error' && this.state.phase !== 'offline') return
    this.schedule(1000)
  }

  async now(): Promise<SyncStatus> {
    if (!this.user) return this.status()
    this.clearTimer()
    this.followUp = false
    await this.run()
    return this.status()
  }

  dispose(): void {
    this.clearTimer()
  }

  // ---- internals ----------------------------------------------------------

  private loadCursor(userId: string): void {
    const store = this.cursorStore
    if (!store) return
    const data = store.get()
    if (data.userId !== userId) {
      this.cursor = 0
      this.lastSyncedAt = null
      store.set({ userId, cursor: 0, lastSyncedAt: 0 })
      return
    }
    const cursor = rowNumber(data.cursor) ?? 0
    const synced = rowNumber(data.lastSyncedAt) ?? 0
    this.cursor = cursor > 0 ? cursor : 0
    this.lastSyncedAt = synced > 0 ? synced : null
  }

  private persistCursor(): void {
    if (!this.user) return
    const store = this.cursorStore
    if (!store) return
    store.set({
      userId: this.user.id,
      cursor: this.cursor,
      lastSyncedAt: this.lastSyncedAt ?? 0
    })
  }

  private flushLocal(): void {
    if (!this.user) return
    // Before the first pull, a missing local record may simply mean the local
    // store has not been merged yet (or failed to load). Deleting on that
    // evidence would erase the account's library everywhere.
    const changed = this.tracker.diff(Date.now(), this.pulled)
    if (changed.length > 0) this.outbox.putAll(changed)
    this.refreshPending()
  }

  private schedule(ms: number): void {
    if (!this.user) return
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private run(): Promise<void> {
    if (!this.user) return Promise.resolve()
    if (this.current) {
      this.rerun = true
      return this.current
    }
    this.current = this.perform().finally(() => {
      this.current = null
      if (this.rerun) {
        this.rerun = false
        this.schedule(500)
      }
    })
    return this.current
  }

  private async perform(): Promise<void> {
    if (!this.user) return
    const userId = this.user.id
    this.attemptAt = Date.now()
    this.publish({ phase: 'syncing', error: null })

    try {
      this.flushLocal()
      if (this.lastSyncedAt === null) {
        // First sync on this install pulls first so an existing server copy is
        // merged before any local record is pushed over it.
        await this.pull()
        if (this.user?.id !== userId) return
        await this.push()
      } else {
        await this.push()
        if (this.user?.id !== userId) return
        await this.pull()
      }
      if (this.user?.id !== userId) return
      this.lastSyncedAt = Date.now()
      this.backoff = 0
      this.persistCursor()
      this.publish({
        phase: 'idle',
        lastSyncedAt: this.lastSyncedAt,
        error: null,
        conflicts: this.totalConflicts()
      })

      // A pull can hand back a local winner that the server still has an older
      // copy of. One follow-up is enough to settle it; anything still queued
      // after that waits for the next real change or a manual sync.
      if (this.outbox.count() > 0) {
        if (!this.followUp) {
          this.followUp = true
          this.schedule(DEBOUNCE_MS)
        }
      } else {
        this.followUp = false
        // Another device may have changed something while this one was idle.
        this.schedule(PULL_INTERVAL_MS)
      }
    } catch (error) {
      if (this.user?.id !== userId) return
      const offline = networkMonitor.isOffline()
      this.publish({
        phase: offline ? 'offline' : 'error',
        error: offline ? null : describeError(error)
      })
      // A transient failure must not park sync until the user edits something:
      // retry with backoff, capped so a long outage still polls occasionally.
      this.backoff = Math.min(this.backoff + 1, 6)
      this.schedule(Math.min(60_000, 2_000 * 2 ** this.backoff))
    }
  }

  private async push(): Promise<void> {
    if (!this.user) return
    const userId = this.user.id
    const client = auth().clientInstance()

    for (let page = 0; page < PUSH_PAGES; page += 1) {
      if (this.user?.id !== userId) return
      const batch = this.outbox.peek(BATCH)
      if (batch.length === 0) return

      const { data, error } = await client.rpc('sync_push', {
        p_records: batch.map((record) => ({
          kind: record.kind,
          record_id: record.recordId,
          payload: record.payload ?? {},
          updated_at: record.updatedAt,
          device_id: record.deviceId,
          deleted: record.deleted
        }))
      })
      if (error) throw error
      // The account changed while the batch was in flight: the response and the
      // queue now belong to different users, so drop this run entirely.
      if (this.user?.id !== userId) return

      this.outbox.removePushed(batch)
      this.refreshPending()

      // `sync_push` returns a row only for the records it actually wrote. A
      // record that is missing lost the server-side comparison, so pull that
      // version back instead of dropping the local edit silently.
      const accepted = new Set<string>()
      if (Array.isArray(data)) {
        for (const row of data as SyncRow[]) {
          const key = rowKey(row)
          if (key) accepted.add(key)
        }
      }
      const lost = batch.filter((record) => !accepted.has(outboxKey(record)))
      if (lost.length > 0) await this.reconcile(lost)

      if (batch.length < BATCH) return
    }
  }

  private async reconcile(lost: OutboxRecord[]): Promise<void> {
    if (!this.user || lost.length === 0) return
    // A write the server did not accept lost to a newer copy; that is exactly
    // the case worth telling the user about.
    for (const record of lost) this.noteConflict(record)
    const userId = this.user.id
    const client = auth().clientInstance()
    const keys = lost.map(outboxKey)
    const wanted = new Set(keys)
    const kinds = [...new Set(lost.map((record) => record.kind))]

    const { data, error } = await client
      .from('sync_records')
      .select('kind, record_id, payload, updated_at, device_id, deleted, rev')
      .eq('user_id', userId)
      .in('kind', kinds)
      .limit(Math.min(1000, Math.max(100, lost.length * 4)))
    if (error || !Array.isArray(data)) return
    if (this.user?.id !== userId) return

    const mine = this.tracker.localMap()
    const winners: OutboxRecord[] = []
    for (const row of data as SyncRow[]) {
      const value = rowToRecord(row)
      if (!value) continue
      const key = outboxKey(value)
      if (!wanted.has(key)) continue
      if (!remoteWins(mine.get(key), value)) continue
      const local = mine.get(key)
      if (local && this.tracker.isDirty(local)) this.noteConflict(value)
      winners.push(value)
    }

    if (winners.length === 0) return
    const applied = applyRemoteRecordsTracked(winners).accepted
    this.tracker.acceptAll(applied)
    this.refreshPending()
  }

  private async pull(): Promise<void> {
    if (!this.user) return
    const userId = this.user.id
    const client = auth().clientInstance()

    for (let page = 0; page < PULL_PAGES; page += 1) {
      if (this.user?.id !== userId) return
      const { data, error } = await client
        .from('sync_records')
        .select('kind, record_id, payload, updated_at, device_id, deleted, rev')
        .eq('user_id', userId)
        .gt('rev', this.cursor)
        .order('rev', { ascending: true })
        .limit(PAGE)
      if (error) throw error
      if (this.user?.id !== userId) return

      // The server answered for this account: from here on a local absence is
      // real evidence that the record was deleted, not an unmerged store.
      this.pulled = true
      // An empty install attaching to an account now has the server's settings
      // in hand; stop suppressing the local ones.
      this.tracker.bootstrapComplete()

      const pending = new Map(this.outbox.all().map((record) => [outboxKey(record), record]))
      const rows = Array.isArray(data) ? (data as SyncRow[]) : []
      if (rows.length === 0) return

      const mine = this.tracker.localMap()
      const accept: OutboxRecord[] = []
      const pushBack: OutboxRecord[] = []
      let maxRev = this.cursor

      for (const row of rows) {
        const rev = rowNumber(row.rev)
        if (rev !== null && rev > maxRev) maxRev = rev

        const value = rowToRecord(row)
        if (!value) continue
        const key = outboxKey(value)
        const local = mine.get(key)
        // A pending write is the version the next push will send; compare the
        // remote against that, not against a stored record without a timestamp.
        const pendingRecord = pending.get(key)
        const localVersion = pendingRecord ?? local
        if (remoteWins(localVersion, value)) {
          if (pendingRecord || (local && this.tracker.isDirty(local))) {
            this.noteConflict(value)
          }
          accept.push(value)
        } else if (localVersion && compareVersions(localVersion, value) > 0) {
          // The local copy is newer than the pulled one; make sure the server
          // hears about it unless the outbox already holds that write.
          if (!pendingRecord) pushBack.push(localVersion)
        }
      }

      if (accept.length > 0) {
        // Only the records that actually landed locally count as agreed: an
        // invalid payload is skipped, and history evicted by the 5,000 cap is
        // gone. Marking those agreed would turn the next diff into a tombstone
        // that deletes them for every device.
        const applied = applyRemoteRecordsTracked(accept).accepted
        this.tracker.acceptAll(applied)
      }
      if (pushBack.length > 0) this.outbox.putAll(pushBack)

      this.cursor = maxRev
      this.persistCursor()
      this.refreshPending()

      if (rows.length < PAGE) return
    }
  }

  private refreshPending(): void {
    this.publish({})
  }

  /** A newer remote copy replaced an unpushed local edit. */
  private noteConflict(record: OutboxRecord): void {
    try {
      const store = this.conflictStore
      if (store) {
        const entries = [
          { at: Date.now(), kind: record.kind, recordId: record.recordId },
          ...store.get().entries
        ].slice(0, 50)
        store.set({ entries })
      }
    } catch {
      // A conflict log failure must not change sync behaviour.
    }
    this.publish({ conflicts: this.totalConflicts() })
  }

  private publish(patch: Partial<SyncStatus>): void {
    const next: SyncStatus = {
      ...this.state,
      ...patch,
      pending: this.outbox.count()
    }
    if (JSON.stringify(next) === JSON.stringify(this.state)) return
    this.state = next
    const snapshot = { ...next }
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A listener must not be able to break the engine.
      }
    }
  }
}

let engine: SyncEngine | null = null

export function syncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine()
  return engine
}

/** A local store changed; safely a no-op while signed out. */
export function noteSyncChange(): void {
  if (!engine) return
  engine.noteLocalChange()
}

/** Catch up when the window regains focus. */
export function installFocusSync(): void {
  app.on('browser-window-focus', () => {
    syncEngine().nudge()
  })
}

/** Retry a failed run as soon as the connection returns. */
export function installNetworkSync(): void {
  networkMonitor.onChange(() => {
    if (!networkMonitor.isOffline()) syncEngine().resume()
  })
}

/** Stop timers on quit; the outbox is already durable. */
export function disposeSync(): void {
  engine?.dispose()
}
