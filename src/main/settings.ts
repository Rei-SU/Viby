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
  offlineMode: 'auto',
  /** Check GitHub for a newer release on launch. Updates are never silent. */
  autoUpdateCheck: true,
  /** Empty means no version is skipped. */
  skippedUpdateVersion: ''
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
  }
  return store
}

/** Bitrate ceiling for the current quality setting, or undefined for best. */
export function qualityCapKbps(): number | undefined {
  return settings().get().audioQuality === 'data-saver' ? 64 : undefined
}
