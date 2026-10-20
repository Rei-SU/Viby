import type { VibyApi } from '@shared/ipc'

declare global {
  interface Window {
    viby: VibyApi
  }
}

/** The preload bridge. Nothing else from the main process is reachable. */
export const api: VibyApi = window.viby
