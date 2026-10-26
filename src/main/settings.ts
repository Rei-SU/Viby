import { JsonStore, userDataFile } from './json-store'
import type { Settings } from '@shared/types'

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
  offlineMode: 'auto',
  /** Check GitHub for a newer release on launch. Updates are never silent. */
  autoUpdateCheck: true,
  /** Empty means no version is skipped. */
  skippedUpdateVersion: ''
}

const MIN_CACHE_BYTES = 64 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * ONE_GB

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
  if (input.muted !== undefined) clean.muted = Boolean(input.muted)
  if (input.shuffle !== undefined) clean.shuffle = Boolean(input.shuffle)
  if (input.repeat !== undefined) {
    clean.repeat =
      input.repeat === 'all' || input.repeat === 'one' || input.repeat === 'off'
        ? input.repeat
        : DEFAULT_SETTINGS.repeat
  }
  if (input.autoplay !== undefined) clean.autoplay = Boolean(input.autoplay)
  if (input.backgroundPlayback !== undefined) {
    clean.backgroundPlayback = Boolean(input.backgroundPlayback)
  }
  if (input.offlineMode !== undefined) {
    clean.offlineMode = input.offlineMode === 'offline' ? 'offline' : 'auto'
  }
  if (input.autoUpdateCheck !== undefined) {
    clean.autoUpdateCheck = Boolean(input.autoUpdateCheck)
  }
  if (input.skippedUpdateVersion !== undefined) {
    clean.skippedUpdateVersion =
      typeof input.skippedUpdateVersion === 'string' ? input.skippedUpdateVersion : ''
  }
  return clean
}

let store: JsonStore<Settings> | null = null

/** Lazily created because app.getPath() is only valid once Electron is ready. */
export function settings(): JsonStore<Settings> {
  if (!store) {
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

export function setSettings(patch: Partial<Settings>): Settings {
  return settings().set(sanitizePatch(patch))
}

/** Bitrate ceiling for the current quality setting, or undefined for best. */
export function qualityCapKbps(): number | undefined {
  return settings().get().audioQuality === 'data-saver' ? 64 : undefined
}
