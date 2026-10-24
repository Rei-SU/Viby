/**
 * Stand-in for Electron's `app` module so the resolver can be exercised in plain
 * Node. Only the things main-process modules touch are implemented.
 *
 * `userData` points at the real app data directory so the test reuses the
 * already-provisioned yt-dlp instead of downloading 37MB again.
 */
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

export const app = {
  isPackaged: false,
  getAppPath: (): string => process.cwd(),
  getPath: (name: string): string => {
    if (name !== 'userData') return process.cwd()
    // Development runs pin userData before app.setName('Viby'), so the
    // directory stays lowercase on every platform. Match that here; this stub
    // represents a development app (isPackaged is false), not a packaged one.
    if (platform() === 'win32') {
      return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'viby')
    }
    if (platform() === 'darwin') {
      return join(homedir(), 'Library', 'Application Support', 'viby')
    }
    return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'viby')
  }
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
