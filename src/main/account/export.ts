import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import type { AccountExport, AccountStatus } from '@shared/account'
import { lib } from '../library'
import { settings } from '../settings'
import { getMainWindow } from '../windows'

/**
 * Write the signed-in user's library to a JSON file they choose. This is a
 * local copy of what already lives in userData; no server call is made and no
 * credentials are included.
 */
export async function exportAccount(status: AccountStatus): Promise<AccountExport> {
  if (status.state !== 'signed-in') throw new Error('Sign in to export your account.')

  const exportedAt = Date.now()
  const stamp = new Date(exportedAt).toISOString().slice(0, 10)
  const options = {
    title: 'Export Ondavi account',
    defaultPath: join(app.getPath('downloads'), `ondavi-${stamp}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }

  const window = getMainWindow()
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) throw new Error('Export cancelled.')

  const payload = {
    exportedAt,
    account: { email: status.email, userId: status.userId },
    library: {
      favorites: lib().favorites(),
      playlists: lib().playlists(),
      albums: lib().albums(),
      history: lib().history(5000)
    },
    settings: settings().get()
  }

  await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8')

  return {
    exportedAt,
    email: status.email,
    userId: status.userId,
    path: result.filePath
  }
}
