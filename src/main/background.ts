import { join } from 'node:path'
import { Menu, Tray, app, nativeImage } from 'electron'
import { CH } from '@shared/ipc'
import { getMainWindow, showMainWindow } from './windows'
import { markQuitting, setBackgroundReady } from './lifecycle'

let tray: Tray | null = null

function trayIconPath(): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-win.ico'
  return join(root, 'tray', file)
}

function openWindow(settings = false): void {
  const win = showMainWindow()
  if (!settings) return
  const send = (): void => win.webContents.send(CH.appOpenSettings)
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send)
  else send()
}

function createTray(): void {
  try {
    const image = nativeImage.createFromPath(trayIconPath())
    if (image.isEmpty()) throw new Error(`Tray icon missing: ${trayIconPath()}`)
    if (process.platform === 'darwin') image.setTemplateImage(true)

    tray = new Tray(image)
    tray.setToolTip('Viby')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Viby', click: () => openWindow() },
        { label: 'Settings…', click: () => openWindow(true) },
        { type: 'separator' },
        {
          label: 'Quit Viby',
          click: () => {
            markQuitting()
            app.quit()
          }
        }
      ])
    )
    // macOS opens a context menu on click; Windows uses its usual click-to-open.
    if (process.platform !== 'darwin') tray.on('click', () => openWindow())
    setBackgroundReady(true)
  } catch (error) {
    console.error('[background] tray unavailable', error)
    tray?.destroy()
    tray = null
    setBackgroundReady(false)
  }
}

function destroyTray(): void {
  setBackgroundReady(false)
  tray?.destroy()
  tray = null
}

/** Keep the tray icon in sync with the saved setting. */
export function applyBackgroundPlayback(enabled: boolean): void {
  if (enabled) {
    if (!tray) createTray()
    return
  }
  if (!tray) return

  const win = getMainWindow()
  if (win && !win.isVisible()) showMainWindow()
  destroyTray()
}
