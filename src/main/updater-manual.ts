import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { app, net, shell } from 'electron'
import type { ReleaseInfo } from './updater'

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
  onProgress: (fraction: number) => void
): Promise<string> {
  if (!release.installerUrl) throw new Error('This release has no installer for this Mac.')

  const name = release.installerUrl.split('/').pop() ?? 'Viby.dmg'
  const folder = app.getPath('downloads')
  await mkdir(folder, { recursive: true })
  const file = join(folder, name)
  // Always start clean: a partial file from an interrupted attempt must never
  // be mistaken for a finished installer.
  await rm(file, { force: true })

  const response = await net.fetch(release.installerUrl, {
    signal: AbortSignal.timeout(30 * 60_000)
  })
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`)

  const total = Number(response.headers.get('content-length') ?? 0)
  const hash = createHash('sha256')
  let received = 0

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
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

  if (release.installerSha256 && hash.digest('hex') !== release.installerSha256) {
    await rm(file, { force: true })
    throw new Error('The downloaded installer failed verification.')
  }

  const failure = await shell.openPath(file)
  if (failure) {
    shell.showItemInFolder(file)
    throw new Error('Downloaded, but could not open the installer.')
  }

  return 'Installer opened. Drag Viby into Applications, then reopen it.'
}
