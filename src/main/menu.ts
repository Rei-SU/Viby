import { Menu, app } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

/**
 * The default Electron menu labels the first menu "Electron" in development and
 * shows File/View/Help entries the app does not use. This keeps the standard
 * editing roles (Cmd+C/V must work in the search fields) but brands the app.
 */
export function installMenu(): void {
  const isMac = process.platform === 'darwin'

  if (!isMac) {
    // The app draws its own titlebar; a File/Edit/View menu would be duplicate
    // chrome. Chromium still handles editing shortcuts inside inputs.
    Menu.setApplicationMenu(null)
    return
  }

  app.setAboutPanelOptions({
    applicationName: 'Viby',
    applicationVersion: app.getVersion(),
    copyright: 'Viby'
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Viby',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
        { type: 'separator' },
        { role: 'close' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
