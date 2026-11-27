import type { ConnectDevice } from '@shared/connect'

/**
 * The clock of another device, as seen from this one.
 *
 * `offset` is `localNow - remoteTimestamp`, so `localNow - offset` is roughly
 * the remote's clock. A sample's arrival time always includes network latency,
 * so the offset can only be too small: keep the smallest recent estimate and
 * let it drift up slowly. Only genuinely new snapshots count — Presence
 * heartbeats repeat the last payload, and treating that as a new sample rewinds
 * the song to where it was when the payload was created.
 */
export class DeviceClock {
  private offsets = new Map<string, number>()
  private seen = new Map<string, number>()

  /** Feed the current device rows; repeats and out-of-order samples are ignored. */
  observe(devices: ConnectDevice[], now = Date.now()): void {
    const live = new Set<string>()
    for (const device of devices) {
      live.add(device.id)
      if (!Number.isFinite(device.updatedAt)) continue
      const last = this.seen.get(device.id)
      if (last !== undefined && device.updatedAt <= last) continue
      this.seen.set(device.id, device.updatedAt)

      const candidate = now - device.updatedAt
      const current = this.offsets.get(device.id)
      if (current === undefined || candidate < current) {
        this.offsets.set(device.id, candidate)
      } else {
        // Clock drift between machines is tiny; approach a larger estimate
        // slowly so one slow packet cannot move the song.
        this.offsets.set(device.id, current + (candidate - current) * 0.05)
      }
    }
    for (const id of this.offsets.keys()) {
      if (!live.has(id)) {
        this.offsets.delete(id)
        this.seen.delete(id)
      }
    }
  }

  /** A timestamp in that device's clock, for optimistic local updates. */
  stamp(deviceId: string, now = Date.now()): number {
    return now - (this.offsets.get(deviceId) ?? 0)
  }

  /** Where the device is now, clamped to its track. */
  position(device: ConnectDevice, now = Date.now()): number {
    if (!device.playing) return device.position
    const offset = this.offsets.get(device.id)
    const local = offset === undefined ? now : now - offset
    const elapsed = device.position + Math.max(0, local - device.updatedAt) / 1_000
    const duration = device.track?.durationSec ?? 0
    return duration > 0 ? Math.min(elapsed, duration) : elapsed
  }

  offsetOf(deviceId: string): number | undefined {
    return this.offsets.get(deviceId)
  }
}
