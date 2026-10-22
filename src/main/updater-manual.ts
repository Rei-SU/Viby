import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { app, net, shell } from 'electron'
import type { ReleaseInfo } from './updater'

/** A transfer that delivers nothing for this long is treated as dead. */
const STALL_TIMEOUT = 60_000

/**
 * macOS without a Developer ID cannot install over itself: Squirrel.Mac
 * validates the downloaded app against the running app's designated
 * requirement, and our ad-hoc signature's requirement is a cdhash that changes
 * on every build (PLAN §2.1). So the honest flow is: download the correct DMG
 * ourselves, verify it, open it, and let the user make the one drag.
 *
 * Files written by Viby carry no quarantine flag, so the *updated* copy does
 * not go through Gatekeeper again — only the first install does.
 */
export async function downloadMacInstaller(
  release: ReleaseInfo,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<string> {
  if (!release.installerUrl) throw new Error('This release has no installer for this Mac.')

  const name = installerName(release.installerUrl)
  const folder = app.getPath('downloads')
  await mkdir(folder, { recursive: true })
  const file = join(folder, name)
  // Always start clean: a partial file from an interrupted attempt must never
  // be mistaken for a finished installer.
  await rm(file, { force: true })

  // The signed manifest wins over the GitHub digest when both exist.
  const expected = release.artifacts?.[name] ?? release.installerSha256
  await download(release.installerUrl, file, expected, onProgress, signal)

  const failure = await shell.openPath(file)
  if (failure) {
    shell.showItemInFolder(file)
    throw new Error('Downloaded, but could not open the installer.')
  }

  // Replacing a copy that lives on the mounted DMG (or in Downloads) is not an
  // update. Say what to do instead of letting the drag silently fail.
  if (!inApplications()) {
    return 'Downloaded and opened. Move Viby into Applications first, then drag the new copy over it.'
  }
  return 'Downloaded and opened. Quit Viby, drag the new Viby into Applications, then reopen it.'
}

async function download(
  url: string,
  file: string,
  expectedSha256: string | undefined,
  onProgress: (fraction: number) => void,
  signal: AbortSignal
): Promise<void> {
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  signal.addEventListener('abort', forwardAbort, { once: true })

  let stall = setTimeout(() => controller.abort(), STALL_TIMEOUT)
  const arm = (): void => {
    clearTimeout(stall)
    stall = setTimeout(() => controller.abort(), STALL_TIMEOUT)
  }

  try {
    const response = await net.fetch(url, { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)

    const total = Number(response.headers.get('content-length') ?? 0)
    const hash = createHash('sha256')
    let received = 0

    const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    source.on('data', (chunk: Buffer) => {
      arm()
      hash.update(chunk)
      received += chunk.length
      if (total > 0) onProgress(received / total)
    })

    await new Promise<void>((resolve, reject) => {
      const sink = createWriteStream(file)
      source.on('error', reject)
      sink.on('error', reject)
      sink.on('finish', resolve)
      source.pipe(sink)
    })

    if (expectedSha256 && hash.digest('hex') !== expectedSha256) {
      throw new Error('The downloaded installer failed verification.')
    }
  } catch (error) {
    // Never leave a half-written installer behind: the next attempt would
    // otherwise open a corrupt DMG.
    await rm(file, { force: true })
    if (controller.signal.aborted) {
      throw new Error('The download stalled. Check your connection and try again.')
    }
    throw error
  } finally {
    signal.removeEventListener('abort', forwardAbort)
    clearTimeout(stall)
  }
}

function installerName(url: string): string {
  const candidate = url.split('/').pop() ?? ''
  return candidate && candidate !== '.' && candidate !== '..' ? candidate : 'Viby.dmg'
}

/** Dev builds and apps launched from a DMG run outside /Applications. */
function inApplications(): boolean {
  try {
    return app.isInApplicationsFolder()
  } catch {
    return false
  }
}
