/**
 * Stand-in for Electron's `app` module so the resolver can be exercised in plain
 * Node. Only the things main-process modules touch are implemented.
 *
 * `userData` points at the real app data directory so the test reuses the
 * already-provisioned yt-dlp instead of downloading 37MB again.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const app = {
  isPackaged: false,
  getAppPath: (): string => process.cwd(),
  getPath: (name: string): string =>
    name === 'userData' ? join(homedir(), 'Library/Application Support/viby') : process.cwd()
}

/** Mutable so connectivity tests can flip the machine's state. */
export const net = {
  online: true,
  isOnline: (): boolean => net.online,
  fetch: async (_url: string, _init?: unknown): Promise<{ status: number }> => ({ status: 200 })
}

export const powerMonitor = {
  on: (_event: string, _listener: () => void): void => undefined,
  removeListener: (_event: string, _listener: () => void): void => undefined
}
