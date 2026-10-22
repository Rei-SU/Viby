import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { autoUpdater, CancellationToken } from 'electron-updater'
import { isNewer } from './version'
import type { NativeUpdater } from './updater'

/** electron-updater emits progress often; a silent transfer is dead after this. */
const STALL_TIMEOUT = 120_000

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
  // Never fall back to a web installer: updates must be a file we can hash.
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = createLogger()

  return {
    async check(): Promise<string | null> {
      const result = await autoUpdater.checkForUpdates()
      const version = result?.updateInfo.version
      if (!version) return null
      return isNewer(version, app.getVersion()) ? version : null
    },

    download(
      onProgress: (fraction: number) => void,
      signal: AbortSignal,
      expectedSha256?: string
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        const token = new CancellationToken()
        let stalled = false
        let stall = setTimeout(() => {
          stalled = true
          token.cancel()
        }, STALL_TIMEOUT)
        const arm = (): void => {
          clearTimeout(stall)
          stall = setTimeout(() => {
            stalled = true
            token.cancel()
          }, STALL_TIMEOUT)
        }

        const cleanup = (): void => {
          clearTimeout(stall)
          signal.removeEventListener('abort', handleAbort)
          autoUpdater.off('download-progress', handleProgress)
          autoUpdater.off('update-downloaded', handleDownloaded)
          autoUpdater.off('error', handleError)
        }
        const handleAbort = (): void => token.cancel()
        const handleProgress = (info: { percent: number }): void => {
          arm()
          onProgress(info.percent / 100)
        }
        const handleDownloaded = async (event: { downloadedFile: string }): Promise<void> => {
          cleanup()
          if (!expectedSha256) return resolve()
          try {
            const actual = await sha256File(event.downloadedFile)
            if (actual === expectedSha256) return resolve()
            // The signed manifest and the installer disagree: discard the file
            // rather than hand it to NSIS.
            await rm(event.downloadedFile, { force: true })
            reject(new Error('The downloaded update failed verification.'))
          } catch (error) {
            reject(error)
          }
        }
        const handleError = (error: Error): void => {
          cleanup()
          reject(error)
        }

        if (signal.aborted) return reject(new Error('Download cancelled.'))
        signal.addEventListener('abort', handleAbort, { once: true })
        autoUpdater.on('download-progress', handleProgress)
        autoUpdater.on('update-downloaded', handleDownloaded)
        autoUpdater.on('error', handleError)
        void autoUpdater.downloadUpdate(token).catch((error: Error) => {
          cleanup()
          reject(stalled ? new Error('The download stalled. Check your connection and try again.') : error)
        })
      })
    },

    install(): void {
      // Not silent; relaunch afterwards so the user lands back in the app.
      autoUpdater.quitAndInstall(false, true)
    }
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * electron-updater logs to stdout, which a Windows user cannot send us. A small
 * file next to the app's other logs makes update failures diagnosable.
 */
function createLogger(): {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string): void
} {
  const line = (level: string, message: string): void => {
    const text = `${new Date().toISOString()} ${level} ${message}\n`
    void (async () => {
      try {
        const folder = app.getPath('logs')
        await mkdir(folder, { recursive: true })
        await appendFile(join(folder, 'updater.log'), text).catch(() => writeFile(join(folder, 'updater.log'), text))
      } catch {
        // Logging must never break an update.
      }
    })()
  }

  return {
    info: (message) => line('info', message),
    warn: (message) => line('warn', message),
    error: (message) => line('error', message),
    // electron-updater is chatty at debug level; keep the file small.
    debug: () => {}
  }
}
