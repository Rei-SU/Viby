import { isIP } from 'node:net'
import os from 'node:os'

/**
 * `Reis-MacBook-Pro.local` -> `Reis MacBook Pro`. A machine whose hostname is a
 * bare IP (common on macOS when the Bonjour name was never set) gets a friendly
 * platform label instead of an address nobody can identify.
 */
export function deviceName(): string {
  const raw = os.hostname().replace(/\.(local|lan|home|localdomain)$/i, '')
  const cleaned = raw.replace(/[-_]+/g, ' ').trim()
  if (!cleaned || isIP(cleaned) !== 0) {
    if (process.platform === 'darwin') return 'Mac'
    if (process.platform === 'win32') return 'Windows PC'
    return 'Linux PC'
  }
  return cleaned.slice(0, 60)
}

export function platformName(): string {
  switch (process.platform) {
    case 'darwin':
      return 'macOS'
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return 'Desktop'
  }
}
