/**
 * Stand-in for Electron's `app` module so the resolver can be exercised in plain
 * Node. Only the three things binary.ts touches are implemented.
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
