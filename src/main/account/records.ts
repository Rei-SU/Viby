import { createHash } from 'node:crypto'
import type { HistoryEntry, Playlist, SavedAlbum, Settings, Track } from '@shared/types'
import type { LibraryChange } from '@shared/ipc'
import { JsonStore, userDataFile } from '../json-store'
import { lib, type RemoteLibraryOps } from '../library'
import { applyRemoteSettings, settings } from '../settings'
import { deviceId } from './device'
import { keyParts, recordKey, type SyncKind } from './compare'
import type { OutboxRecord } from './outbox'

/**
 * Mapping between the local JSON stores and sync records.
 *
 * The local stores stay authoritative: nothing here changes where favourites,
 * playlists, albums or history live day to day. The tracker only remembers, per
 * user, the last version this device agreed on with the server so a diff can
 * tell a real edit from a record that merely came back through a pull.
 */

/** Only these settings travel. Volume, window and download preferences stay local. */
export const SYNCED_SETTINGS = [
  'audioQuality',
  'shuffle',
  'repeat',
  'autoplay',
  'discordPresence'
] as const

export type SyncedSettingKey = (typeof SYNCED_SETTINGS)[number]

export const HISTORY_LIMIT = 5000
/** A tombstone keeps a deletion from being resurrected for this long. */
export const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000

/**
 * `trackId:playedAt` identifies one play. Track ids never contain a colon, and
 * the played-at side is a number, so the last colon is the split point.
 */
export function historyRecordId(entry: { trackId: string; playedAt: number }): string {
  return `${entry.trackId}:${entry.playedAt}`
}

export function parseHistoryRecordId(recordId: string): { trackId: string; playedAt: number } | null {
  const at = recordId.lastIndexOf(':')
  if (at <= 0) return null
  const trackId = recordId.slice(0, at)
  const playedAt = Number(recordId.slice(at + 1))
  if (!trackId || !Number.isFinite(playedAt)) return null
  return { trackId, playedAt }
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}

function record(kind: SyncKind, recordId: string, payload: unknown, updatedAt: number): OutboxRecord {
  return { kind, recordId, payload, updatedAt, deviceId: deviceId(), deleted: false }
}

/** Everything the local stores currently hold, as sync records. */
export function readLocalRecords(): Map<string, OutboxRecord> {
  const book = lib()
  const out = new Map<string, OutboxRecord>()

  const add = (kind: SyncKind, recordId: string, payload: unknown, updatedAt: number): void => {
    out.set(recordKey(kind, recordId), record(kind, recordId, payload, updatedAt))
  }

  for (const track of book.favorites()) add('favorite', track.id, track, 0)
  for (const playlist of book.playlists()) {
    const stamp = typeof playlist.updatedAt === 'number' && Number.isFinite(playlist.updatedAt)
      ? playlist.updatedAt
      : 0
    // Metadata and entries sync separately: adding one song must not replace
    // the whole playlist on every other device.
    add(
      'playlist',
      playlist.id,
      {
        id: playlist.id,
        name: playlist.name,
        createdAt: playlist.createdAt,
        updatedAt: playlist.updatedAt
      },
      stamp
    )
    playlist.tracks.forEach((track, index) => {
      const position =
        typeof track.playlistPosition === 'number' && Number.isFinite(track.playlistPosition)
          ? track.playlistPosition
          : index
      const value = { ...track }
      delete value.playlistPosition
      add(
        'playlist_track',
        `${playlist.id}:${track.id}`,
        { playlistId: playlist.id, track: value, position },
        0
      )
    })
  }
  for (const album of book.albums()) {
    const stamp = typeof album.savedAt === 'number' && Number.isFinite(album.savedAt) ? album.savedAt : 0
    add('album', album.id, album, stamp)
  }
  for (const entry of book.history(HISTORY_LIMIT)) {
    add('history', historyRecordId(entry), entry, entry.playedAt)
  }

  const current = settings().get()
  for (const key of SYNCED_SETTINGS) add('setting', key, { value: current[key] }, 0)

  return out
}

type MetaEntry = { updatedAt: number; deviceId: string; hash: string; deleted: boolean }
type MetaData = { userId: string; records: Record<string, MetaEntry>; bootstrap?: boolean }

/**
 * Which account, if any, this install's local library has been handed to. It
 * is written the first time a library is adopted so a second account signing in
 * on the same machine does not upload the first account's library as its own.
 */
type LibraryOwnerData = { owner: string }
let ownerStore: JsonStore<LibraryOwnerData> | null = null

function libraryOwnerStore(): JsonStore<LibraryOwnerData> {
  if (!ownerStore) {
    ownerStore = new JsonStore<LibraryOwnerData>(userDataFile('account-library.json'), { owner: '' })
  }
  return ownerStore
}

/**
 * Last-known server-agreed version of every record for one account. Kept per
 * user id: switching accounts re-seeds so the new account receives the local
 * library rather than inheriting another account's bookkeeping.
 */
export class RecordTracker {
  private readonly store = new JsonStore<MetaData>(userDataFile('account-records.json'), {
    userId: '',
    records: {}
  })
  private userId: string | null = null
  /**
   * An empty install attaching to an existing account must take the server's
   * settings, not push this device's defaults over them. While true, settings
   * are left out of the diff and the pull comparison until the first pull has
   * completed.
   */
  private ignoreSettings = false

  /**
   * Bind the tracker to an account. Returns records to push on a first sign-in.
   *
   * Seeding adopts the local library only when no other account has adopted it
   * yet. Otherwise the records are recorded as already known but not queued, so
   * a second account starts from its own server copy and only this account's
   * future edits travel.
   */
  begin(userId: string): OutboxRecord[] {
    this.userId = userId
    const data = this.store.get()
    if (data.userId === userId && data.records && typeof data.records === 'object') {
      this.ignoreSettings = data.bootstrap === true
      return []
    }

    const owner = libraryOwnerStore().get().owner
    const adopt = owner === '' || owner === userId
    const local = readLocalRecords()
    // Favourites, playlists, albums or plays make this device's library worth
    // adopting. Settings alone (always present as defaults) do not.
    const hasContent = [...local.keys()].some((key) => keyParts(key)?.kind !== 'setting')
    const emptyAttach = adopt && !hasContent
    // Seeded records are stamped now: they describe what this device holds at
    // sign-in time. Stamping them 0 let any older server row or tombstone win
    // and silently revert the user's most recent local state.
    const stamp = Date.now()
    const device = deviceId()
    const records: Record<string, MetaEntry> = {}
    const seeded: OutboxRecord[] = []
    if (!emptyAttach) {
      for (const [key, value] of local) {
        records[key] = {
          updatedAt: adopt ? stamp : value.updatedAt,
          deviceId: adopt ? device : value.deviceId,
          hash: hashPayload(value.payload),
          deleted: false
        }
        if (adopt) seeded.push({ ...value, updatedAt: stamp, deviceId: device, deleted: false })
      }
    }
    this.ignoreSettings = emptyAttach
    this.store.set({ userId, records, bootstrap: emptyAttach })
    if (adopt) libraryOwnerStore().set({ owner: userId })
    return seeded
  }

  /** The first pull has completed; settings can be compared normally again. */
  bootstrapComplete(): void {
    if (!this.ignoreSettings) return
    this.ignoreSettings = false
    const data = this.store.get()
    if (data.userId && data.bootstrap) this.store.set({ ...data, bootstrap: false })
  }

  stop(): void {
    this.userId = null
    this.ignoreSettings = false
  }

  get account(): string | null {
    return this.userId
  }

  /** The version this device currently holds, tombstones included. */
  localMap(): Map<string, OutboxRecord> {
    const local = readLocalRecords()
    if (this.ignoreSettings) {
      for (const key of local.keys()) {
        if (keyParts(key)?.kind === 'setting') local.delete(key)
      }
    }
    const data = this.store.get()
    for (const [key, entry] of Object.entries(data.records ?? {})) {
      if (!entry.deleted || local.has(key)) continue
      const parts = keyParts(key)
      if (!parts) continue
      local.set(key, {
        kind: parts.kind,
        recordId: parts.recordId,
        payload: null,
        updatedAt: entry.updatedAt,
        deviceId: entry.deviceId,
        deleted: true
      })
    }
    return local
  }

  /**
   * Compare the local stores with what this device last agreed on. Returns the
   * records that need to go to the server: edits, resurrections and tombstones.
   *
   * `allowDeletions` is false until the account has been pulled once. A record
   * missing from the local store before that is not evidence of a deletion —
   * the store may still be on defaults after a failed load, and inferring a
   * tombstone from that would erase the account's library on every device.
   */
  diff(now = Date.now(), allowDeletions = true): OutboxRecord[] {
    if (!this.userId) return []
    // A library that could not be parsed is running on empty defaults. Its
    // emptiness must not be interpreted as "the user deleted everything".
    if (lib().loadFailed) return []
    const data = this.store.get()
    const records: Record<string, MetaEntry> = { ...(data.records ?? {}) }
    const local = readLocalRecords()
    const device = deviceId()
    const changed: OutboxRecord[] = []
    let dirty = false

    for (const [key, value] of local) {
      if (this.ignoreSettings && keyParts(key)?.kind === 'setting') continue
      const entry = records[key]
      const hash = hashPayload(value.payload)
      if (!entry || entry.deleted || entry.hash !== hash) {
        records[key] = { updatedAt: now, deviceId: device, hash, deleted: false }
        changed.push({ ...value, updatedAt: now, deviceId: device, deleted: false })
        dirty = true
      }
    }

    if (!allowDeletions) {
      if (dirty) this.store.set({ userId: this.userId, records })
      return changed
    }

    for (const [key, entry] of Object.entries(records)) {
      if (local.has(key)) continue
      if (entry.deleted) {
        if (now - entry.updatedAt > TOMBSTONE_MS) {
          delete records[key]
          dirty = true
        }
        continue
      }
      const parts = keyParts(key)
      if (!parts) {
        delete records[key]
        dirty = true
        continue
      }
      records[key] = { updatedAt: now, deviceId: device, hash: '', deleted: true }
      changed.push({
        kind: parts.kind,
        recordId: parts.recordId,
        payload: null,
        updatedAt: now,
        deviceId: device,
        deleted: true
      })
      dirty = true
    }

    if (dirty) this.store.set({ userId: this.userId, records })
    return changed
  }

  /** True when this record differs from the last version agreed with the server. */
  isDirty(record: { kind: SyncKind; recordId: string; payload: unknown }): boolean {
    const entry = this.store.get().records?.[recordKey(record.kind, record.recordId)]
    if (!entry || entry.deleted) return true
    return entry.hash !== hashPayload(record.payload)
  }

  /** A pulled copy won; remember it so the next diff does not echo it back. */
  acceptAll(records: OutboxRecord[]): void {
    if (!this.userId || records.length === 0) return
    const data = this.store.get()
    const meta: Record<string, MetaEntry> = { ...(data.records ?? {}) }
    for (const value of records) {
      meta[recordKey(value.kind, value.recordId)] = {
        updatedAt: value.updatedAt,
        deviceId: value.deviceId,
        hash: hashPayload(value.payload),
        deleted: value.deleted
      }
    }
    this.store.set({ userId: this.userId, records: meta })
  }
}

// ---- payload validation ---------------------------------------------------

function asTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object') return null
  const track = value as Partial<Track>
  if (typeof track.id !== 'string' || track.id.length === 0) return null
  if (typeof track.title !== 'string') return null
  if (typeof track.artist !== 'string') return null
  if (typeof track.durationSec !== 'number' || !Number.isFinite(track.durationSec)) return null
  return track as Track
}

function asPlaylist(value: unknown): Playlist | null {
  if (!value || typeof value !== 'object') return null
  const playlist = value as Partial<Playlist>
  if (typeof playlist.id !== 'string' || playlist.id.length === 0) return null
  if (typeof playlist.name !== 'string') return null
  if (typeof playlist.createdAt !== 'number' || typeof playlist.updatedAt !== 'number') return null
  // Server playlists are metadata only; entries are separate records.
  return {
    id: playlist.id,
    name: playlist.name,
    createdAt: playlist.createdAt,
    updatedAt: playlist.updatedAt,
    tracks: []
  }
}

function asPlaylistItem(
  value: unknown
): { playlistId: string; track: Track; position: number } | null {
  if (!value || typeof value !== 'object') return null
  const item = value as { playlistId?: unknown; track?: unknown; position?: unknown }
  if (typeof item.playlistId !== 'string' || item.playlistId.length === 0) return null
  const track = asTrack(item.track)
  if (!track) return null
  if (typeof item.position !== 'number' || !Number.isFinite(item.position)) return null
  return { playlistId: item.playlistId, track, position: item.position }
}

function asAlbum(value: unknown): SavedAlbum | null {
  if (!value || typeof value !== 'object') return null
  const album = value as Partial<SavedAlbum>
  if (typeof album.id !== 'string' || album.id.length === 0) return null
  if (typeof album.title !== 'string' || album.title.length === 0) return null
  if (typeof album.savedAt !== 'number' || !Number.isFinite(album.savedAt)) return null
  return album as SavedAlbum
}

function asHistory(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<HistoryEntry>
  if (typeof entry.trackId !== 'string' || entry.trackId.length === 0) return null
  if (typeof entry.playedAt !== 'number' || !Number.isFinite(entry.playedAt)) return null
  return {
    ...(entry as HistoryEntry),
    title: typeof entry.title === 'string' ? entry.title : '',
    artist: typeof entry.artist === 'string' ? entry.artist : '',
    completion: typeof entry.completion === 'number' ? entry.completion : 0
  }
}

function asSettingValue(payload: unknown): { value: unknown } | null {
  if (!payload || typeof payload !== 'object') return null
  if (!('value' in payload)) return null
  return { value: (payload as { value: unknown }).value }
}

// ---- applying a pull ------------------------------------------------------

/**
 * The download manager mirrors playlist and favourite ownership. A pull changes
 * the library exactly like a local edit does, so main registers a sink here to
 * keep downloads in step without `records.ts` importing the download layer.
 */
let remoteLibrarySink: ((ops: RemoteLibraryOps) => void) | null = null

export function setRemoteLibrarySink(sink: ((ops: RemoteLibraryOps) => void) | null): void {
  remoteLibrarySink = sink
}

let remoteApplyListener: ((change: LibraryChange) => void) | null = null

/** Main registers one to tell the renderer which stores a pull changed. */
export function setRemoteApplyListener(listener: ((change: LibraryChange) => void) | null): void {
  remoteApplyListener = listener
}

function notifyApplied(change: LibraryChange): void {
  if (!remoteApplyListener) return
  try {
    remoteApplyListener(change)
  } catch {
    // A renderer notification must not abort a pull.
  }
}

function notifySink(ops: RemoteLibraryOps): void {
  if (!remoteLibrarySink) return
  try {
    remoteLibrarySink(ops)
  } catch {
    // A download bookkeeping failure must not abort a pull.
  }
}

/**
 * Write pulled records into the local stores and report exactly which records
 * the local stores now hold. The caller hands only those to the tracker as
 * agreed: a payload that failed validation, or a history play evicted by the
 * 5,000 cap, is not "agreed" and must not become a tombstone on the next diff.
 */
export function applyRemoteRecordsTracked(records: OutboxRecord[]): {
  applied: number
  accepted: OutboxRecord[]
} {
  if (records.length === 0) return { applied: 0, accepted: [] }
  const ops: RemoteLibraryOps = {
    favorites: { upsert: [], remove: [] },
    playlists: { upsert: [], remove: [] },
    playlistItems: { upsert: [], remove: [] },
    albums: { upsert: [], remove: [] },
    history: { upsert: [], remove: [] }
  }
  const patch: Partial<Settings> = {}
  const accepted: OutboxRecord[] = []

  for (const value of records) {
    switch (value.kind) {
      case 'favorite': {
        if (value.deleted) {
          ops.favorites!.remove!.push(value.recordId)
        } else {
          const track = asTrack(value.payload)
          if (!track) continue
          ops.favorites!.upsert!.push(track)
        }
        break
      }
      case 'playlist': {
        if (value.deleted) {
          ops.playlists!.remove!.push(value.recordId)
        } else {
          const playlist = asPlaylist(value.payload)
          if (!playlist) continue
          const meta = {
            id: playlist.id,
            name: playlist.name,
            createdAt: playlist.createdAt,
            updatedAt: playlist.updatedAt
          }
          ops.playlists!.upsert!.push({ ...meta, tracks: [] })
          // Normalise older payloads that still carry a tracks array so the
          // tracker's hash matches what this client writes.
          value.payload = meta
        }
        break
      }
      case 'playlist_track': {
        if (value.deleted) {
          const at = value.recordId.indexOf(':')
          if (at <= 0) continue
          ops.playlistItems!.remove!.push({
            playlistId: value.recordId.slice(0, at),
            trackId: value.recordId.slice(at + 1)
          })
        } else {
          const item = asPlaylistItem(value.payload)
          if (!item) continue
          const track = { ...item.track }
          delete track.playlistPosition
          ops.playlistItems!.upsert!.push({ ...item, track })
          value.payload = {
            playlistId: item.playlistId,
            track,
            position: item.position
          }
        }
        break
      }
      case 'album': {
        if (value.deleted) {
          ops.albums!.remove!.push(value.recordId)
        } else {
          const album = asAlbum(value.payload)
          if (!album) continue
          ops.albums!.upsert!.push(album)
        }
        break
      }
      case 'history': {
        const id = parseHistoryRecordId(value.recordId)
        if (!id) continue
        if (value.deleted) ops.history!.remove!.push(id)
        else {
          const entry = asHistory(value.payload)
          if (!entry) continue
          ops.history!.upsert!.push(entry)
        }
        break
      }
      case 'setting': {
        // A setting is always present locally; a tombstone has no meaning.
        if (value.deleted) continue
        if (!(SYNCED_SETTINGS as readonly string[]).includes(value.recordId)) continue
        const settingValue = asSettingValue(value.payload)
        if (!settingValue) continue
        ;(patch as Record<string, unknown>)[value.recordId] = settingValue.value
        break
      }
    }
    accepted.push(value)
  }

  lib().applyRemote(ops)

  // Only item changes can alter download ownership; a metadata-only page (or a
  // page whose items arrive later) must not look like an empty playlist.
  const touchedPlaylists = new Set<string>()
  for (const entry of ops.playlistItems?.upsert ?? []) touchedPlaylists.add(entry.playlistId)
  for (const entry of ops.playlistItems?.remove ?? []) touchedPlaylists.add(entry.playlistId)
  const currentPlaylists = new Map(lib().playlists().map((playlist) => [playlist.id, playlist]))
  notifySink({
    favorites: ops.favorites,
    playlists: {
      upsert: [...touchedPlaylists]
        .map((id) => currentPlaylists.get(id))
        .filter((playlist): playlist is Playlist => Boolean(playlist)),
      remove: ops.playlists?.remove ?? []
    }
  })

  // Settings pulled from another device must take effect here too: going
  // through `applyRemoteSettings` runs the same side effects (cache eviction,
  // Discord presence, launch-at-login) as a change made in this window.
  if (Object.keys(patch).length > 0) applyRemoteSettings(patch)

  // History is capped locally. A play the cap evicted is not held by this
  // device after the merge, so it cannot be claimed as agreed.
  let final = accepted
  if (accepted.some((value) => value.kind === 'history' && !value.deleted)) {
    const kept = new Set(lib().history(HISTORY_LIMIT).map(historyRecordId))
    final = accepted.filter((value) => value.kind !== 'history' || value.deleted || kept.has(value.recordId))
  }

  const changedPlaylists = new Set<string>()
  for (const playlist of ops.playlists?.upsert ?? []) changedPlaylists.add(playlist.id)
  for (const id of ops.playlists?.remove ?? []) changedPlaylists.add(id)
  for (const entry of ops.playlistItems?.upsert ?? []) changedPlaylists.add(entry.playlistId)
  for (const entry of ops.playlistItems?.remove ?? []) changedPlaylists.add(entry.playlistId)

  const change: LibraryChange = {
    favorites: Boolean(ops.favorites?.upsert?.length || ops.favorites?.remove?.length),
    albums: Boolean(ops.albums?.upsert?.length || ops.albums?.remove?.length),
    history: Boolean(ops.history?.upsert?.length || ops.history?.remove?.length),
    playlists: [...changedPlaylists],
    settings: Object.keys(patch).length > 0
  }
  if (change.favorites || change.albums || change.history || change.playlists.length > 0 || change.settings) {
    notifyApplied(change)
  }

  return { applied: final.length, accepted: final }
}

/** The applied count, for callers that do not need the record list. */
export function applyRemoteRecords(records: OutboxRecord[]): number {
  return applyRemoteRecordsTracked(records).applied
}
