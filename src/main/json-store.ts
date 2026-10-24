import { join } from 'node:path'
import { app } from 'electron'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'

/**
 * Tiny atomic JSON store. P1 does not need a queryable database yet; PLAN §4
 * moves this to `node:sqlite` in P2 once the library grows real queries.
 *
 * Writes go to a temp file and are then renamed, so a crash mid-write can never
 * leave a half-written file behind.
 */
export function recoveryMarkerFor(file: string): string {
  return `${file}.recovery-needed`
}

export class JsonStore<T extends object> {
  private data: T
  /** True when an existing file could not be parsed; the app is on defaults. */
  readonly loadFailed: boolean = false

  constructor(
    private readonly file: string,
    defaults: T
  ) {
    this.data = { ...defaults }
    try {
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('store must contain a JSON object')
        }
        this.data = { ...defaults, ...(parsed as Partial<T>) }
      }
    } catch {
      // Keep the corrupt file for diagnosis and make destructive caches pause
      // until it is dealt with. Overwriting it with defaults silently was how a
      // single bad byte could erase every download on the next sweep.
      this.loadFailed = true
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`)
      } catch {
        // If even the rename fails, the recovery marker still blocks sweeps.
      }
      try {
        mkdirSync(join(file, '..'), { recursive: true })
        writeFileSync(
          recoveryMarkerFor(file),
          JSON.stringify({ at: Date.now(), file })
        )
      } catch {
        // Best effort; the process-local flag still protects this run.
      }
    }
  }

  get(): T {
    return this.data
  }

  set(patch: Partial<T>): T {
    this.data = { ...this.data, ...patch }
    this.flush()
    return this.data
  }

  /** Mutate in place and persist. */
  update(fn: (data: T) => void): T {
    fn(this.data)
    this.flush()
    return this.data
  }

  /**
   * Write immediately. These files are a few kilobytes, and the previous
   * debounce meant a quit within 250ms could silently lose the last favourite or
   * playlist change.
   */
  flush(): void {
    const tmp = `${this.file}.tmp`
    mkdirSync(join(this.file, '..'), { recursive: true })
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }
}

export function userDataFile(name: string): string {
  return join(app.getPath('userData'), name)
}
