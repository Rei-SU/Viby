import { app } from 'electron'
import type { Settings } from '@shared/types'

/**
 * Launch at login.
 *
 * Registration is a packaged-app concern: in development `process.execPath` is
 * Electron itself, so writing a login item would point the OS at the framework
 * rather than Viby. The stored setting still works, and a packaged build applies
 * it on every startup and whenever the toggle changes.
 *
 * Windows login items can carry arguments, which is how "start minimized" is
 * detected (a normal shortcut does not have the flag). macOS login items cannot,
 * so the OS's `wasOpenedAtLogin` is the signal there.
 */

export const LOGIN_LAUNCH_ARG = '--launch-at-login'

export type LoginItemOptions = {
  openAtLogin: boolean
  path?: string
  args?: string[]
}

export function loginItemOptions(
  settings: Pick<Settings, 'launchAtLogin' | 'launchMinimized'>,
  platform: NodeJS.Platform,
  isPackaged: boolean,
  execPath: string
): LoginItemOptions | null {
  if (!isPackaged) return null

  if (platform === 'win32') {
    const options: LoginItemOptions = {
      openAtLogin: settings.launchAtLogin,
      path: execPath
    }
    if (settings.launchMinimized) options.args = [LOGIN_LAUNCH_ARG]
    return options
  }

  if (platform === 'darwin') {
    // No args on macOS; `wasOpenedAtLogin` identifies a login start.
    return { openAtLogin: settings.launchAtLogin }
  }

  return null
}

export function applyLaunchAtLogin(settings: Pick<Settings, 'launchAtLogin' | 'launchMinimized'>): void {
  const options = loginItemOptions(settings, process.platform, app.isPackaged, process.execPath)
  if (!options) return
  try {
    app.setLoginItemSettings(options)
  } catch (error) {
    // A login item is a convenience; never take startup down over it.
    console.error('[startup] could not update the login item', error)
  }
}

/** True when this process came from the OS login item, not a user click. */
export function launchedAtLogin(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'win32') return process.argv.includes(LOGIN_LAUNCH_ARG)
  if (process.platform === 'darwin') {
    try {
      return app.getLoginItemSettings().wasOpenedAtLogin === true
    } catch {
      return false
    }
  }
  return false
}
