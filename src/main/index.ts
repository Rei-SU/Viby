import { join } from 'node:path'
import { app, dialog, protocol, session } from 'electron'
import { MEDIA_SCHEME } from './media'
import { handleMediaProtocol, registerIpc } from './ipc'
import { installMenu } from './menu'
import { createWindow, showMainWindow } from './windows'
import { applyBackgroundPlayback } from './background'
import { initTaskbar } from './taskbar'
import { isQuitting, keepsAppAlive, markQuitting } from './lifecycle'
import { settings } from './settings'
import { applyLaunchAtLogin, launchedAtLogin } from './startup'
import { initDiscord, stopDiscord } from './discord'

// Dev-only: lets the app be driven and inspected over the DevTools protocol
// (PLAN §12). Never enabled in a packaged build.
if (!app.isPackaged && process.env.VIBY_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.VIBY_DEBUG_PORT)
}

// Development runs as plain "Electron" and would otherwise label the menu and
// Dock that way. Rename it Viby, but pin userData first: it is keyed to
// app.getName(), and moving it would orphan settings, library and cache.
// Packaged builds already carry Viby in the bundle (CFBundleName/DisplayName).
if (!app.isPackaged) {
  const userData = app.getPath('userData')
  app.setName('Viby')
  app.setPath('userData', userData)
}

// Windows binds an SMTC media session to a taskbar button by Application User
// Model ID, and the id it looks for is the one the installer puts on its
// shortcuts (`appId` in electron-builder.yml). A process started directly — the
// installer's "run Viby", a bare exe, or a dev run — inherits no id, so the
// shell can drive Viby from the media flyout but has nothing to match its
// Now Playing controls against in the taskbar.
if (process.platform === 'win32') {
  // A dev run must not claim the installed app's identity: Windows would group
  // the window under the installed shortcut and use its (older) icon instead of
  // the window's own. The packaged build still matches the installer's AUMID.
  app.setAppUserModelId(app.isPackaged ? 'com.viby.app' : 'com.viby.app.dev')
}

// Music must keep playing when the window is behind another app or minimised.
// Chromium otherwise throttles the renderer and suspends "background media" to
// save power, which shows up as play() being interrupted and playback stopping.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')

// Must run before app is ready. `standard` + `secure` let the renderer treat
// cached audio URLs as first-class media sources without weakening webSecurity.
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error)
  try {
    dialog.showErrorBox('Viby encountered an error', error.stack || error.message)
  } catch {
    // The app may not be ready enough to show a dialog.
  }
  app.quit()
})
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason)
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Normal quits (menu, Cmd+Q, updater, OS shutdown) must win over close-to-tray.
  app.on('before-quit', () => {
    markQuitting()
    // Closing the socket removes the activity from Discord immediately.
    stopDiscord()
  })

  /**
   * The renderer never makes network requests; everything goes through IPC.
   * Development needs the Vite WebSocket, but the packaged app can keep the
   * whole renderer offline. This is defense in depth for any future XSS.
   */
  function installProductionCsp(): void {
    if (!app.isPackaged) return
    const csp =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: https: viby-media:; " +
      "media-src 'self' blob: https: viby-media:; connect-src 'self'; " +
      "font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-src 'none'"
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      })
    })
  }

  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow()
  })

  app
    .whenReady()
    .then(() => {
      // The packaged app gets its icon from the bundle; in development the Dock
      // would otherwise show the generic Electron icon.
      if (!app.isPackaged && process.platform === 'darwin' && app.dock) {
        app.dock.setIcon(join(app.getAppPath(), 'resources', 'icon.png'))
      }

      installMenu()
      installProductionCsp()

      // Touch settings once so defaults are written on first launch.
      const current = settings().get()
      // Keep the OS login item in sync with the saved choice (packaged only).
      applyLaunchAtLogin(current)
      initDiscord(current.discordPresence)
      const startMinimized =
        current.launchAtLogin && current.launchMinimized && launchedAtLogin()

      handleMediaProtocol()
      registerIpc()
      initTaskbar()
      createWindow({ startMinimized })
      applyBackgroundPlayback(current.backgroundPlayback)

      app.on('activate', () => {
        showMainWindow()
      })
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.stack || error.message : String(error)
      console.error('[startup] failed', message)
      dialog.showErrorBox(
        'Viby could not start',
        'A local data file could not be read. Details:\n\n' + message.slice(0, 1500)
      )
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (isQuitting() || keepsAppAlive()) return
    if (process.platform !== 'darwin') app.quit()
  })
}
