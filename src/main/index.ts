import { join } from 'node:path'
import { app, dialog, protocol } from 'electron'
import { MEDIA_SCHEME } from './media'
import { handleMediaProtocol, registerIpc } from './ipc'
import { installMenu } from './menu'
import { createWindow } from './windows'
import { settings } from './settings'

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
  app.on('second-instance', () => {
    const [win] = require('electron').BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
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

      // Touch settings once so defaults are written on first launch.
      settings().get()

      handleMediaProtocol()
      registerIpc()
      createWindow()

      app.on('activate', () => {
        const { BrowserWindow } = require('electron')
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
    if (process.platform !== 'darwin') app.quit()
  })
}
