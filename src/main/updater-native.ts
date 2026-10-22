import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { isNewer } from './version'
import type { NativeUpdater } from './updater'

/**
 * Windows adapter. NSIS installs per-user, so an unsigned build can replace
 * itself without an administrator prompt — the same reason `latest.yml` is
 * published only for Windows (PLAN §2.1).
 *
 * `autoDownload` stays off: checking must never spend the user's bandwidth.
 */
export function createNativeUpdater(): NativeUpdater {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  return {
    async check(): Promise<string | null> {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo.version
      if (!version) return null
      return isNewer(version, app.getVersion()) ? version : null
    },

    download(onProgress: (fraction: number) => void): Promise<void> {
      return new Promise((resolve, reject) => {
        const cleanup = (): void => {
          autoUpdater.off('download-progress', handleProgress)
          autoUpdater.off('update-downloaded', handleDownloaded)
          autoUpdater.off('error', handleError)
        }
        const handleProgress = (info: { percent: number }): void => {
          onProgress(info.percent / 100)
        }
        const handleDownloaded = (): void => {
          cleanup()
          resolve()
        }
        const handleError = (error: Error): void => {
          cleanup()
          reject(error)
        }

        autoUpdater.on('download-progress', handleProgress)
        autoUpdater.on('update-downloaded', handleDownloaded)
        autoUpdater.on('error', handleError)
        void autoUpdater.downloadUpdate().catch((error: Error) => {
          cleanup()
          reject(error)
        })
      })
    },

    install(): void {
      // Not silent; relaunch afterwards so the user lands back in the app.
      autoUpdater.quitAndInstall(false, true)
    }
  }
}
