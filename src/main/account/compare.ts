/**
 * Record identity and ordering shared by the outbox, the tracker and the sync
 * engine.
 *
 * The order is the same one `sync_push` applies server-side:
 *
 *   (updated_at, device_id, deleted)
 *
 * Greater wins; an exact tie means the holder stays. Postgres sorts `false`
 * before `true`, so a tombstone (deleted) beats a live record that carries the
 * very same timestamp and device. Device ids are lower-case UUIDs, which keeps
 * the text comparison identical under a C collation and under the default one.
 */

export const SYNC_KINDS = ['favorite', 'playlist', 'playlist_track', 'album', 'history', 'setting'] as const

export type SyncKind = (typeof SYNC_KINDS)[number]

export function isSyncKind(value: unknown): value is SyncKind {
  return typeof value === 'string' && (SYNC_KINDS as readonly string[]).includes(value)
}

/** NUL cannot appear in a kind or an id, so the key is unambiguous. */
export function recordKey(kind: SyncKind, recordId: string): string {
  return `${kind}\u0000${recordId}`
}

export function keyParts(key: string): { kind: SyncKind; recordId: string } | null {
  const at = key.indexOf('\u0000')
  if (at < 0) return null
  const kind = key.slice(0, at)
  const recordId = key.slice(at + 1)
  if (!isSyncKind(kind) || recordId.length === 0) return null
  return { kind, recordId }
}

export type Versioned = {
  /** Epoch milliseconds of the write, as the writing device saw it. */
  updatedAt: number
  deviceId: string
  deleted: boolean
}

/**
 * > 0 when `a` should replace `b`, < 0 when `b` should replace `a`, 0 for an
 * exact tie (keep whoever you already have).
 */
export function compareVersions(a: Versioned, b: Versioned): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? 1 : -1
  if (a.deleted !== b.deleted) return a.deleted ? 1 : -1
  return 0
}

/** True when the pulled copy should overwrite the local one. */
export function remoteWins(local: Versioned | null | undefined, remote: Versioned): boolean {
  if (!local) return true
  return compareVersions(remote, local) > 0
}
