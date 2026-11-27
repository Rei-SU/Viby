import { existsSync, renameSync } from 'node:fs'
import { JsonStore, userDataFile } from '../json-store'
import { isSyncKind, recordKey, type SyncKind } from './compare'
import { accountFile, legacyOutboxFile } from './library-root'

/**
 * One pending write. The payload is the record's full local state (or nothing
 * for a tombstone); a newer write for the same kind and record replaces it.
 */
export type OutboxRecord = {
  kind: SyncKind
  recordId: string
  payload: unknown
  updatedAt: number
  deviceId: string
  deleted: boolean
}

type OutboxData = { records: OutboxRecord[] }

export function outboxKey(record: { kind: SyncKind; recordId: string }): string {
  return recordKey(record.kind, record.recordId)
}

/** Entries read back from disk may have been hand-edited; drop what is unusable. */
function isValidRecord(value: unknown): value is OutboxRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<OutboxRecord>
  return (
    isSyncKind(record.kind) &&
    typeof record.recordId === 'string' &&
    record.recordId.length > 0 &&
    typeof record.updatedAt === 'number' &&
    Number.isFinite(record.updatedAt) &&
    typeof record.deviceId === 'string' &&
    typeof record.deleted === 'boolean'
  )
}

/** One queue file per account, so two accounts never share pending writes. */
function queueFile(userId: string): string {
  const path = accountFile(userId, 'outbox.json')
  const legacy = legacyOutboxFile(userId)
  if (!existsSync(path) && existsSync(legacy)) {
    try {
      renameSync(legacy, path)
    } catch {
      return legacy
    }
  }
  return path
}

/**
 * The durable queue between a local library change and the server. It is
 * written with the same atomic JSON store as the library, so a crash cannot
 * lose a change that was already made on this device.
 *
 * A queue belongs to exactly one account. The singleton is re-scoped through
 * `useUser()`; keeping a per-account file is what stops A's pending edits and
 * tombstones from being pushed into B's account after a sign-out and sign-in
 * on the same machine.
 */
export class Outbox {
  private store: JsonStore<OutboxData>
  /** An explicit file (tests/tools) is never re-scoped and needs no owner. */
  private readonly fixed: boolean
  private owner: string | null = null

  constructor(file?: string) {
    this.fixed = file !== undefined
    this.store = this.open(file)
  }

  private open(file?: string): JsonStore<OutboxData> {
    const store = new JsonStore<OutboxData>(file ?? userDataFile('account-outbox.json'), {
      records: []
    })
    const loaded = store.get().records
    if (!Array.isArray(loaded) || loaded.some((record) => !isValidRecord(record))) {
      store.set({ records: Array.isArray(loaded) ? loaded.filter(isValidRecord) : [] })
    }
    return store
  }

  /**
   * Point the queue at one account. Each user gets their own file, and a
   * signed-out queue reads empty, so a second sign-in can never inherit the
   * first account's backlog.
   */
  useUser(userId: string | null): void {
    if (this.fixed || this.owner === userId) return
    this.owner = userId
    this.store = this.open(userId ? queueFile(userId) : userDataFile('account-outbox.json'))
  }

  /** No account, no queue: nothing is pending and nothing can be queued. */
  private usable(): boolean {
    return this.fixed || this.owner !== null
  }

  all(): OutboxRecord[] {
    if (!this.usable()) return []
    const records = this.store.get().records
    return Array.isArray(records) ? records : []
  }

  count(): number {
    return this.all().length
  }

  /** Replace any earlier write for the same record. */
  put(record: OutboxRecord): void {
    this.putAll([record])
  }

  putAll(records: OutboxRecord[]): void {
    if (records.length === 0 || !this.usable()) return
    const byKey = new Map<string, OutboxRecord>()
    for (const existing of this.all()) byKey.set(outboxKey(existing), existing)
    for (const record of records) {
      if (isValidRecord(record)) byKey.set(outboxKey(record), record)
    }
    this.store.set({ records: [...byKey.values()] })
  }

  /** The oldest pending writes; the server applies them with the same rule. */
  peek(limit: number): OutboxRecord[] {
    return this.all().slice(0, Math.max(0, limit))
  }

  /**
   * Drop the versions that were just pushed. A record the user changed while
   * the request was in flight has already replaced the queued copy and stays:
   * its serialised form no longer matches what went to the server.
   */
  removePushed(pushed: OutboxRecord[]): void {
    if (pushed.length === 0 || !this.usable()) return
    const sent = new Map(pushed.map((record) => [outboxKey(record), JSON.stringify(record)]))
    this.store.set({
      records: this.all().filter((current) => {
        const payload = sent.get(outboxKey(current))
        return payload === undefined || payload !== JSON.stringify(current)
      })
    })
  }

  removeKeys(keys: string[]): void {
    if (keys.length === 0 || !this.usable()) return
    const drop = new Set(keys)
    this.store.set({ records: this.all().filter((record) => !drop.has(outboxKey(record))) })
  }

  clear(): void {
    this.store.set({ records: [] })
  }
}

let outbox: Outbox | null = null

export function outboxStore(): Outbox {
  if (!outbox) outbox = new Outbox()
  return outbox
}
