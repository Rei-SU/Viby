import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { userDataFile } from '../json-store'

/**
 * The refresh token is the only long-lived credential the app holds. It lives
 * in one small file, encrypted by the OS keychain through Electron's
 * safeStorage; the access token stays in memory for the life of the process.
 *
 * If safeStorage is unavailable (a Linux box without a keyring, for example)
 * the vault keeps the session in memory only. It never falls back to plaintext
 * on disk.
 */
export class TokenVault {
  private readonly file = userDataFile('account-tokens.bin')
  private data: Record<string, string> | null = null
  private encrypted = true

  /** True when the session survives a restart on this machine. */
  get persistent(): boolean {
    return this.encrypted && safeStorage.isEncryptionAvailable()
  }

  getItem(key: string): string | null {
    return this.load()[key] ?? null
  }

  setItem(key: string, value: string): void {
    const data = { ...this.load(), [key]: value }
    this.data = data
    this.save(data)
  }

  removeItem(key: string): void {
    const data = { ...this.load() }
    delete data[key]
    this.data = data
    this.save(data)
  }

  /** Has a session ever been stored here? Checked before the first network call. */
  get hasSession(): boolean {
    for (const value of Object.values(this.load())) {
      if (typeof value === 'string' && value.length > 0) return true
    }
    return false
  }

  clear(): void {
    this.data = {}
    try {
      rmSync(this.file, { force: true })
    } catch {
      // Best effort: the in-memory copy is already empty.
    }
  }

  private load(): Record<string, string> {
    if (this.data) return this.data
    this.data = {}
    if (!existsSync(this.file)) return this.data

    try {
      const raw = readFileSync(this.file)
      if (!safeStorage.isEncryptionAvailable()) {
        // Written by a run that had a keyring; this one cannot read it. Keep
        // the file (a later run with a keyring may still decrypt it).
        return this.data
      }
      const json = safeStorage.decryptString(raw)
      const parsed = JSON.parse(json) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === 'string') this.data[key] = value
        }
      }
    } catch {
      // A corrupt or foreign-keychain file must not stop the app from starting;
      // the user simply signs in again.
      this.data = {}
    }
    return this.data
  }

  private save(data: Record<string, string>): void {
    if (!safeStorage.isEncryptionAvailable()) {
      // Memory-only session: no plaintext token ever reaches the disk.
      this.encrypted = false
      return
    }
    this.encrypted = true
    try {
      const encrypted = safeStorage.encryptString(JSON.stringify(data))
      mkdirSync(join(this.file, '..'), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, encrypted)
      renameSync(tmp, this.file)
    } catch {
      // Keep the session for this run even if the write failed.
      this.encrypted = false
    }
  }

  /** Absolute path of the vault file, for diagnostics that never show contents. */
  get path(): string {
    return this.file
  }
}

let vault: TokenVault | null = null

/** Lazily created because safeStorage is only meaningful once Electron is ready. */
export function tokenVault(): TokenVault {
  if (!vault) vault = new TokenVault()
  return vault
}

/** Test/dev helper: the folder the vault writes into. */
export function accountDataDir(): string {
  return app.getPath('userData')
}
