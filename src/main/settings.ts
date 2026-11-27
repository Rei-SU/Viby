import { existsSync } from 'node:fs'
import { JsonStore, userDataFile } from './json-store'
import type { Settings } from '@shared/types'
import { accountFile } from './account/library-root'

export const SYNCED_SETTINGS = ['audioQuality', 'shuffle', 'repeat', 'autoplay', 'discordPresence'] as const
type SyncedSettingKey = (typeof SYNCED_SETTINGS)[number]
type AccountSettings = Pick<Settings, SyncedSettingKey>

export const ONE_GB = 1024 * 1024 * 1024

export const DEFAULT_SETTINGS: Settings = {
  audioQuality: 'best',
  cacheCapBytes: ONE_GB,
  volume: 1,
  muted: false,
  shuffle: false,
  repeat: 'off',
  autoplay: true,
  /** Off preserves the platform-default close behavior until the user opts in. */
  backgroundPlayback: false,
  /** On by default: Viby is meant to be running before you reach for it. */
  launchAtLogin: true,
  /** A visible window is the least surprising first launch; this is opt-in. */
  launchMinimized: false,
  offlineMode: 'auto',
  /** Check GitHub for a newer release on launch. Updates are never silent. */
  autoUpdateCheck: true,
  /** Show the current song on Discord. On by default; the app still needs Discord running. */
  discordPresence: true,
  /** Empty means no version is skipped. */
  skippedUpdateVersion: '',
  /** Empty means Viby has never shown release notes on this install. */
  lastSeenVersion: '',
  /** Empty means no sheet has ever been displayed here. */
  lastShownVersion: ''
}

const MIN_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * ONE_GB

/** settings.json is user-editable; only a real boolean may change a flag. */
function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Validate only the keys present in a patch; settings.json may be user-edited. */
function sanitizePatch(patch: Partial<Settings> | null | undefined): Partial<Settings> {
  const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}
  const clean: Partial<Settings> = {}
  if (input.audioQuality !== undefined) {
    clean.audioQuality =
      input.audioQuality === 'data-saver' || input.audioQuality === 'best'
        ? input.audioQuality
        : DEFAULT_SETTINGS.audioQuality
  }
  if (input.cacheCapBytes !== undefined) {
    const value = Number(input.cacheCapBytes)
    clean.cacheCapBytes = Number.isFinite(value)
      ? Math.min(MAX_CACHE_BYTES, Math.max(MIN_CACHE_BYTES, Math.round(value)))
      : DEFAULT_SETTINGS.cacheCapBytes
  }
  if (input.volume !== undefined) {
    const value = Number(input.volume)
    clean.volume = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_SETTINGS.volume
  }
  if (input.muted !== undefined) clean.muted = asBoolean(input.muted, DEFAULT_SETTINGS.muted)
  if (input.shuffle !== undefined) {
    clean.shuffle = asBoolean(input.shuffle, DEFAULT_SETTINGS.shuffle)
  }
  if (input.repeat !== undefined) {
    clean.repeat =
      input.repeat === 'all' || input.repeat === 'one' || input.repeat === 'off'
        ? input.repeat
        : DEFAULT_SETTINGS.repeat
  }
  if (input.autoplay !== undefined) {
    clean.autoplay = asBoolean(input.autoplay, DEFAULT_SETTINGS.autoplay)
  }
  if (input.backgroundPlayback !== undefined) {
    clean.backgroundPlayback = asBoolean(
      input.backgroundPlayback,
      DEFAULT_SETTINGS.backgroundPlayback
    )
  }
  if (input.launchAtLogin !== undefined) {
    clean.launchAtLogin = asBoolean(input.launchAtLogin, DEFAULT_SETTINGS.launchAtLogin)
  }
  if (input.launchMinimized !== undefined) {
    clean.launchMinimized = asBoolean(input.launchMinimized, DEFAULT_SETTINGS.launchMinimized)
  }
  if (input.offlineMode !== undefined) {
    clean.offlineMode = input.offlineMode === 'offline' ? 'offline' : 'auto'
  }
  if (input.autoUpdateCheck !== undefined) {
    clean.autoUpdateCheck = asBoolean(input.autoUpdateCheck, DEFAULT_SETTINGS.autoUpdateCheck)
  }
  if (input.discordPresence !== undefined) {
    clean.discordPresence = asBoolean(
      input.discordPresence,
      DEFAULT_SETTINGS.discordPresence
    )
  }
  if (input.skippedUpdateVersion !== undefined) {
    clean.skippedUpdateVersion =
      typeof input.skippedUpdateVersion === 'string' ? input.skippedUpdateVersion : ''
  }
  if (input.lastSeenVersion !== undefined) {
    clean.lastSeenVersion = typeof input.lastSeenVersion === 'string' ? input.lastSeenVersion : ''
  }
  if (input.lastShownVersion !== undefined) {
    clean.lastShownVersion = typeof input.lastShownVersion === 'string' ? input.lastShownVersion : ''
  }
  return clean
}

let store: JsonStore<Settings> | null = null
let firstRun = false
let accountStore: JsonStore<AccountSettings> | null = null
let accountId: string | null = null
let needsAccountSettings = false

function syncedPatch(patch: Partial<Settings>): Partial<AccountSettings> {
  const result: Partial<AccountSettings> = {}
  for (const key of SYNCED_SETTINGS) {
    if (patch[key] !== undefined) Object.assign(result, { [key]: patch[key] })
  }
  return result
}

function syncedSettings(value: AccountSettings): AccountSettings {
  const { audioQuality, shuffle, repeat, autoplay, discordPresence } = value
  return { audioQuality, shuffle, repeat, autoplay, discordPresence }
}

/** True when this launch created settings.json, i.e. nothing was here before. */
export function isFirstRun(): boolean {
  // Determine it even if nothing has touched the settings yet; startup normally
  // does, but the changelog answer must not depend on that ordering.
  settings()
  return firstRun
}

/** Lazily created because app.getPath() is only valid once Electron is ready. */
function deviceSettings(): JsonStore<Settings> {
  if (!store) {
    // Captured before the store creates the file: an upgrade already has one,
    // so an empty changelog baseline is not mistaken for a fresh install.
    firstRun = !existsSync(userDataFile('settings.json'))
    store = new JsonStore<Settings>(userDataFile('settings.json'), DEFAULT_SETTINGS)
    // Older builds used 'medium' for what is now the data saver.
    if ((store.get().audioQuality as string) === 'medium') {
      store.set({ audioQuality: 'data-saver' })
    }
    const clean = sanitizePatch(store.get())
    if (JSON.stringify(clean) !== JSON.stringify(store.get())) store.set(clean)
  }
  return store
}

export function settings(): Pick<JsonStore<Settings>, 'get' | 'set'> {
  const local = deviceSettings()
  if (!accountStore) return local
  const account = accountStore
  return {
    get: () => ({ ...local.get(), ...syncedSettings(account.get()) }),
    set: (patch) => {
      const synced = syncedPatch(patch)
      const device = { ...patch }
      for (const key of SYNCED_SETTINGS) delete device[key]
      if (Object.keys(device).length > 0) local.set(device)
      if (Object.keys(synced).length > 0) account.set(synced)
      return { ...local.get(), ...syncedSettings(account.get()) }
    }
  }
}

export function setActiveSettings(userId: string | null): boolean {
  if (accountId === userId) return false
  const previous = settings().get()
  accountId = userId
  const file = userId ? accountFile(userId, 'settings.json') : null
  const defaults = syncedSettings(DEFAULT_SETTINGS)
  needsAccountSettings = Boolean(file && !existsSync(file))
  accountStore = file ? new JsonStore(file, defaults) : null
  if (accountStore?.loadFailed) needsAccountSettings = true
  if (accountStore && !needsAccountSettings) {
    const stored = syncedSettings(accountStore.get())
    const clean = syncedPatch(sanitizePatch(stored))
    if (JSON.stringify(clean) !== JSON.stringify(stored)) accountStore.set(clean)
  }
  const next = settings().get()
  runSettingsEffect(previous, next, syncedPatch(next))
  return true
}

export function accountSettingsNeedPull(): boolean {
  return needsAccountSettings
}

export function finishAccountSettingsPull(): void {
  if (!needsAccountSettings) return
  accountStore?.flush()
  needsAccountSettings = false
}

export function setSettings(patch: Partial<Settings>): Settings {
  return settings().set(sanitizePatch(patch))
}

/**
 * Side effects that make a setting take effect in the main process (cache
 * eviction, Discord presence, login item, network mode). Main registers one so
 * a value pulled from another device runs the same path as a local change.
 */
export type SettingsEffect = (previous: Settings, next: Settings, patch: Partial<Settings>) => void

let settingsEffect: SettingsEffect | null = null

export function setSettingsEffect(effect: SettingsEffect | null): void {
  settingsEffect = effect
}

/** Write settings that came from sync, then apply their process-wide effects. */
export function applyRemoteSettings(patch: Partial<Settings>): Settings {
  const previous = settings().get()
  const next = setSettings(patch)
  runSettingsEffect(previous, next, patch)
  return next
}

function runSettingsEffect(previous: Settings, next: Settings, patch: Partial<Settings>): void {
  if (settingsEffect) {
    try {
      settingsEffect(previous, next, patch)
    } catch {
      // A side effect must not make a pull fail halfway.
    }
  }
}

/** Bitrate ceiling for the current quality setting, or undefined for best. */
export function qualityCapKbps(): number | undefined {
  return settings().get().audioQuality === 'data-saver' ? 64 : undefined
}
