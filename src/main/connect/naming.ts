import os from 'node:os'

/** `Reis-MacBook-Pro.local` -> `Reis MacBook Pro`, bounded and never empty. */
export function deviceName(): string {
  const raw = os.hostname().replace(/\.(local|lan|home|localdomain)$/i, '')
  const cleaned = raw.replace(/[-_]+/g, ' ').trim()
  return (cleaned || 'This computer').slice(0, 60)
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
