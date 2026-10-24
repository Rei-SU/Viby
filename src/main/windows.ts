import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, shell } from 'electron'

export function createWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin'

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
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'resources', 'icon.png'),
    // `hiddenInset` hides the title bar but keeps the traffic lights; the renderer
    // provides the drag region (a window with no draggable area cannot be moved,
    // which is exactly what happened before the titlebar existed).
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 13 } : undefined,
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

  win.once('ready-to-show', () => win.show())

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
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })

  if (!app.isPackaged && devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
