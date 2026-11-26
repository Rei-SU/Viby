import { randomUUID } from 'node:crypto'
import { JsonStore, userDataFile } from '../json-store'

type DeviceData = { id: string }

let store: JsonStore<DeviceData> | null = null

/**
 * A stable, lower-case UUID that names this install. It is the tie-breaker for
 * writes that land in the same millisecond, so it must survive restarts and
 * must never change for one install: a new id would look like a new device.
 *
 * It is not a secret and not a fingerprint — it is random and only used to
 * order two equal timestamps.
 */
export function deviceId(): string {
  if (!store) {
    store = new JsonStore<DeviceData>(userDataFile('account-device.json'), { id: '' })
  }
  const existing = store.get().id
  if (typeof existing === 'string' && existing.length >= 8) return existing

  const id = randomUUID().toLowerCase()
  store.set({ id })
  return id
}
