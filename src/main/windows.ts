import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, shell } from 'electron'
import { CH, type NavCommand } from '@shared/ipc'
import { shouldHideOnClose } from './lifecycle'

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/** Restore the existing window, or recreate it after a crash or window close. */
export function showMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return existing
  }
  return createWindow()
}

export function createWindow(options: { startMinimized?: boolean } = {}): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  const isMac = process.platform === 'darwin'
  const isWin = process.platform === 'win32'

  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 860,
    minHeight: 560,
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: '#0b0b0d',
    // Packaged Windows uses the executable's icon; dev builds need it explicitly.
    // Windows gets the full-bleed mark, macOS the rounded app tile.
    icon: app.isPackaged
      ? undefined
      : join(
          app.getAppPath(),
          'resources',
          process.platform === 'win32' ? 'icon-win.png' : 'icon.png'
        ),
    // `hiddenInset` hides the title bar but keeps the traffic lights on macOS.
    // On Windows we also hide the native caption and let the OS draw the
    // min/max/close buttons as an overlay on top of the renderer's titlebar,
    // so there is a single 46px chrome row instead of a native bar stacked
    // above the custom one (which is what `default` produced).
    titleBarStyle: isMac ? 'hiddenInset' : isWin ? 'hidden' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 13 } : undefined,
    titleBarOverlay: isWin
      ? { color: '#00000000', symbolColor: '#f2f2f5', height: 46 }
      : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // Keep audio (and the UI clock) running when the window is not visible.
      backgroundThrottling: false
    }
  })

  win.once('ready-to-show', () => {
    if (options.startMinimized) {
      // A login launch should not steal focus. Showing it inactive first is
      // what gives the window a taskbar/Dock button it can be restored from.
      win.showInactive()
      win.minimize()
    } else {
      win.show()
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.on('close', (event) => {
    if (!shouldHideOnClose()) return
    event.preventDefault()
    win.hide()
  })

  // Mouse side buttons that the renderer never sees. A plain XBUTTON arrives
  // there as `mouseup` with button 3 or 4; these two paths are the leftovers:
  // a driver that reports through WM_APPCOMMAND (Windows/Linux), and macOS
  // mice whose vendor software turns the buttons into an AppKit swipe.
  const sendNavigate = (command: NavCommand): void => {
    if (!win.isDestroyed()) win.webContents.send(CH.appNavigate, command)
  }

  win.on('app-command', (_event, command) => {
    if (command === 'browser-backward') sendNavigate('back')
    else if (command === 'browser-forward') sendNavigate('forward')
  })

  // Electron names a swipe after the gesture's deltaX, so `left` is the gesture
  // Chrome reads as Back — the same mapping macOS browsers use.
  win.on('swipe', (_event, direction) => {
    if (direction === 'left') sendNavigate('back')
    else if (direction === 'right') sendNavigate('forward')
  })

  // Surface renderer errors in the dev log. Without this, a renderer-side failure
  // is invisible from the terminal and you end up guessing at causes.
  if (!app.isPackaged) {
    const onConsoleMessage = (...args: unknown[]): void => {
      // Electron 32+ passes a single details object; older builds pass
      // (event, level, message, ...). Accept both.
      const first = args[0] as { message?: unknown; level?: unknown } | undefined
      const message =
        typeof first?.message === 'string'
          ? first.message
          : typeof args[2] === 'string'
            ? args[2]
            : ''
      if (message) console.log(`[renderer ${String(first?.level ?? args[1] ?? '')}] ${message}`)
    }
    win.webContents.on('console-message', onConsoleMessage as never)
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const appFileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href

  const isSafeExternal = (url: string): boolean => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  }

  const isAppNavigation = (url: string): boolean => {
    if (url === appFileUrl || url.startsWith(`${appFileUrl}#`)) return true
    if (!devUrl) return false
    try {
      const target = new URL(url)
      const dev = new URL(devUrl)
      return target.origin === dev.origin
    } catch {
      return false
    }
  }

  // External links open in the real browser, never inside the app shell. Only
  // web schemes are allowed: `shell.openExternal` can otherwise launch local
  // files, SMB shares or arbitrary protocol handlers.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // A navigation would load an arbitrary document into a window that still has
  // the Viby preload bridge, i.e. full access to downloads and the library.
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url)) return
    event.preventDefault()
    if (isSafeExternal(url)) void shell.openExternal(url)
  })

  // Nothing in Viby needs camera, microphone, notifications or geolocation.
  // Deny both the permission request and the synchronous check APIs so feature
  // detection cannot report a capability the app will never be granted.
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.webContents.session.setDevicePermissionHandler(() => false)

  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
