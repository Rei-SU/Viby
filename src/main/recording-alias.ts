import { JsonStore } from './json-store'

type Link = { other: string; at: number }
type AliasData = { links: Record<string, Link> }

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/**
 * A music-video row and its official audio release are two ids for one
 * recording. Cache and downloads key by different ids; this persistent map
 * lets either side find the other for lookups, offline playback and policy.
 */
export class RecordingAliases {
  private store: JsonStore<AliasData>
  private reverse = new Map<string, string>()

  constructor(
    file: string,
    private readonly cap = 5000
  ) {
    this.store = new JsonStore<AliasData>(file, { links: {} })
    this.sanitize()
  }

  /** Remember that `audioId` is the released audio for `rowId`. */
  link(audioId: string, rowId: string): void {
    if (!ID_RE.test(audioId) || !ID_RE.test(rowId) || audioId === rowId) return
    this.store.update((data) => {
      // A row has one released audio; replace any older audio link for it.
      for (const [key, existing] of Object.entries(data.links)) {
        if (key !== audioId && existing.other === rowId) delete data.links[key]
      }
      data.links[audioId] = { other: rowId, at: Date.now() }
      const entries = Object.entries(data.links)
      if (entries.length > this.cap) {
        entries
          .sort((a, b) => a[1].at - b[1].at)
          .slice(0, entries.length - this.cap)
          .forEach(([key]) => delete data.links[key])
      }
    })
    this.rebuild()
  }

  /** The id itself plus its recording counterpart, when one is known. */
  related(id: string): string[] {
    const ids = new Set<string>([id])
    const direct = this.store.get().links[id]
    if (direct?.other) ids.add(direct.other)
    const audio = this.reverse.get(id)
    if (audio) ids.add(audio)
    return [...ids]
  }

  private sanitize(): void {
    const data = this.store.get()
    if (!data.links || typeof data.links !== 'object' || Array.isArray(data.links)) {
      this.store.set({ links: {} })
      return
    }

    let changed = false
    for (const [audioId, link] of Object.entries(data.links)) {
      const valid =
        ID_RE.test(audioId) &&
        link &&
        typeof link === 'object' &&
        typeof link.other === 'string' &&
        ID_RE.test(link.other) &&
        link.other !== audioId &&
        Number.isFinite(link.at)
      if (!valid) {
        delete data.links[audioId]
        changed = true
      }
    }
    const entries = Object.entries(data.links)
    if (entries.length > this.cap) {
      entries
        .sort((a, b) => a[1].at - b[1].at)
        .slice(0, entries.length - this.cap)
        .forEach(([key]) => delete data.links[key])
      changed = true
    }
    if (changed) this.store.set({ links: data.links })
    this.rebuild()
  }

  private rebuild(): void {
    this.reverse.clear()
    for (const [audioId, link] of Object.entries(this.store.get().links)) {
      // Rows map to exactly one audio release; the newest link wins.
      const previous = this.reverse.get(link.other)
      const previousAt = previous ? (this.store.get().links[previous]?.at ?? 0) : -1
      if (!previous || link.at > previousAt) this.reverse.set(link.other, audioId)
    }
  }
}
