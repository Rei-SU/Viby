/**
 * Update state machine with injected platform adapters. No Electron, no
 * network. Run:
 *   node tests/unit.mjs updates
 */
import type { UpdateState } from '../src/shared/types'
import { Updater, UpdateIntegrityError, type ReleaseInfo, type UpdaterDeps } from '../src/main/updater'
import { releaseFromGithub } from '../src/main/release-feed'
import { manifestPayload, verifyManifest } from '../src/main/update-manifest'
import { generateKeyPairSync } from 'node:crypto'
import {
  manifestPayload as scriptManifestPayload,
  signManifest
} from '../scripts/update-manifest.mjs'

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

function build(over: Partial<UpdaterDeps> = {}): {
  updater: Updater
  states: UpdateState[]
} {
  const states: UpdateState[] = []
  const deps: UpdaterDeps = {
    currentVersion: '0.1.0',
    offline: () => false,
    latestRelease: async (): Promise<ReleaseInfo> => ({
      version: '0.2.0',
      url: 'https://example.test/v0.2.0',
      installerUrl: 'https://example.test/Viby-macos-arm.dmg'
    }),
    onState: (state) => states.push(state),
    ...over
  }
  return { updater: new Updater(deps), states }
}

console.log('initial state:')
{
  const { updater } = build()
  const state = updater.get()
  check('idle before any check', state.phase === 'idle', state.phase)
  check('current version is known', state.currentVersion === '0.1.0')
  check('cannot install without a native adapter', state.canInstall === false)
}

console.log('\noffline:')
{
  let requested = 0
  const { updater, states } = build({
    offline: () => true,
    latestRelease: async () => {
      requested++
      return { version: '0.2.0', url: 'https://example.test' }
    }
  })
  const state = await updater.check()
  check('checking offline is an error', state.phase === 'error', state.phase)
  check('the message says why', /offline/i.test(state.message ?? ''), state.message)
  check('no request is made', requested === 0)
  check('the state is broadcast', states.length > 0)
}

console.log('\nunpackaged builds without an adapter:')
{
  const { updater } = build()
  const state = await updater.check()
  check('explains that only the packaged app updates', /packaged app/i.test(state.message ?? ''), state.message)
}

console.log('\nmacOS: a newer release is offered as a download:')
{
  let note = ''
  const { updater, states } = build({
    downloadManual: async (_release, onProgress) => {
      onProgress(0.5)
      onProgress(1)
      note = 'Installer opened.'
      return note
    }
  })
  const checked = await updater.check()
  check('available', checked.phase === 'available', checked.phase)
  check('the offered version is kept', checked.version === '0.2.0')
  check('the user must finish the install', checked.canInstall === false)
  check('checkedAt is stamped', typeof checked.checkedAt === 'number')

  const downloaded = await updater.download()
  check('ends in the manual phase', downloaded.phase === 'manual', downloaded.phase)
  check('the note is surfaced', downloaded.message === 'Installer opened.', downloaded.message)
  check('progress completes', downloaded.progress === 1, String(downloaded.progress))
  check(
    'progress events were broadcast',
    states.some((state) => state.phase === 'downloading' && state.progress === 0.5)
  )

  const again = await updater.download()
  check('manual downloads can be retried', again.phase === 'manual')
}

console.log('\nmacOS: the manual phase can quit the app:')
{
  let quits = 0
  const { updater } = build({
    downloadManual: async () => 'Installer opened.',
    quit: () => {
      quits++
    }
  })
  await updater.check()
  await updater.download()
  updater.install()
  check('install quits so the app can be replaced', quits === 1, String(quits))
}

console.log('\nmacOS: a release without an installer for this Mac is not offered:')
{
  const { updater } = build({
    downloadManual: async () => 'opened',
    latestRelease: async () => ({ version: '0.2.0', url: 'https://example.test' })
  })
  const state = await updater.check()
  check('error instead of a dead Download button', state.phase === 'error', state.phase)
  check('the message names the version', /0\.2\.0/.test(state.message ?? ''), state.message)
  check('no version is offered', state.version === undefined)
}

console.log('\nmacOS: already current (including an older or invalid tag):')
{
  for (const version of ['0.1.0', '0.0.9', 'not-a-version']) {
    const { updater } = build({
      downloadManual: async () => 'opened',
      latestRelease: async () => ({ version, url: 'https://example.test' })
    })
    const state = await updater.check()
    check(`${version} is not offered`, state.phase === 'up-to-date', state.phase)
    check(`${version} leaves no version to show`, state.version === undefined)
  }
}

console.log('\nmacOS: failures surface the first line only:')
{
  const { updater } = build({
    downloadManual: async () => 'opened',
    latestRelease: async () => {
      throw new Error('GitHub returned 500.\n    at fetch (release-feed.ts:12)')
    }
  })
  const state = await updater.check()
  check('error phase', state.phase === 'error', state.phase)
  check('message is one line', state.message === 'GitHub returned 500.', state.message)
}

console.log('\nWindows: in-place download and install:')
{
  let installs = 0
  const native = {
    check: async (): Promise<string | null> => '0.2.0',
    download: async (onProgress: (fraction: number) => void): Promise<void> => {
      onProgress(0.25)
      onProgress(0.75)
    },
    install: (): void => {
      installs++
    }
  }
  const { updater, states } = build({
    native,
    latestRelease: async () => ({
      version: '0.2.0',
      url: 'https://example.test',
      artifacts: { 'Viby-windows-x64.exe': 'c'.repeat(64) }
    })
  })
  check('can install in place', updater.get().canInstall === true)

  const checked = await updater.check()
  check('available', checked.phase === 'available', checked.phase)

  const downloaded = await updater.download()
  check('ready to install', downloaded.phase === 'ready', downloaded.phase)
  check('progress completes', downloaded.progress === 1)
  check(
    'progress is mirrored',
    states.filter((state) => state.phase === 'downloading').map((state) => state.progress).join(',') ===
      '0,0.25,0.75'
  )

  updater.install()
  check('install delegates to the native updater', installs === 1, String(installs))
}

console.log('\nWindows: install is inert before the download finishes:')
{
  let installs = 0
  const native = {
    check: async (): Promise<string | null> => '0.2.0',
    download: async (): Promise<void> => undefined,
    install: (): void => {
      installs++
    }
  }
  const { updater } = build({
    native,
    latestRelease: async () => ({
      version: '0.2.0',
      url: 'https://example.test',
      artifacts: { 'Viby-windows-x64.exe': 'c'.repeat(64) }
    })
  })
  await updater.check()
  updater.install()
  check('nothing installed from the available phase', installs === 0, String(installs))
}

console.log('\nWindows: an up-to-date native check offers nothing:')
{
  const native = {
    check: async (): Promise<string | null> => null,
    download: async (): Promise<void> => undefined,
    install: (): void => undefined
  }
  const { updater } = build({ native })
  const state = await updater.check()
  check('up to date', state.phase === 'up-to-date', state.phase)
}

console.log('\noverlapping checks:')
{
  let requested = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { updater } = build({
    downloadManual: async () => 'opened',
    latestRelease: async () => {
      requested++
      await gate
      return {
        version: '0.2.0',
        url: 'https://example.test',
        installerUrl: 'https://example.test/Viby-macos-arm.dmg'
      }
    }
  })
  const first = updater.check()
  const second = await updater.check()
  check('a second check is ignored while checking', second.phase === 'checking', second.phase)
  release()
  const settled = await first
  check('only one request was made', requested === 1, String(requested))
  check('the first check completes', settled.phase === 'available', settled.phase)
}

console.log('\nbackground checks stay quiet:')
{
  const { updater, states } = build({ offline: () => true, downloadManual: async () => 'opened' })
  const state = await updater.check({ quiet: true })
  check('an offline auto-check leaves the state alone', state.phase === 'idle', state.phase)
  check('nothing is broadcast', states.length === 0, String(states.length))
}

console.log('\nbackground checks keep the last good state on failure:')
{
  let fail = false
  const { updater } = build({
    downloadManual: async () => 'opened',
    latestRelease: async () => {
      if (fail) throw new Error('GitHub rate-limited the check.')
      return { version: '0.1.0', url: 'https://example.test' }
    }
  })
  await updater.check()
  check('starts up to date', updater.get().phase === 'up-to-date', updater.get().phase)
  fail = true
  const quiet = await updater.check({ quiet: true })
  check('stays up to date', quiet.phase === 'up-to-date', quiet.phase)
  check('no error message leaks in', quiet.message === undefined, quiet.message)

  const manual = await updater.check()
  check('a check the user asked for reports the failure', manual.phase === 'error', manual.phase)
}

console.log('\ncancelling a download:')
{
  let aborted = false
  const { updater } = build({
    downloadManual: (_release, _onProgress, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(new Error('aborted'))
          },
          { once: true }
        )
      })
  })
  await updater.check()
  const running = updater.download()
  const during = updater.cancel()
  check('cancel takes effect immediately', during.phase === 'downloading', during.phase)
  const settled = await running
  check('the adapter received the abort', aborted)
  check('the update is offered again', settled.phase === 'available', settled.phase)
  check('the user is told it was cancelled', settled.message === 'Download cancelled.', settled.message)
}

console.log('\nskipping a version:')
{
  let skipped = '0.2.0'
  const { updater } = build({
    skippedVersion: () => skipped,
    downloadManual: async () => 'opened'
  })
  const state = await updater.check()
  check('a skipped version is not offered', state.phase === 'up-to-date', state.phase)
  check('the state is marked skipped', state.skipped === true, String(state.skipped))
  check('the message names the version', /0\.2\.0/.test(state.message ?? ''), state.message)

  skipped = '0.3.0'
  const next = await updater.check()
  check('a different version is still offered', next.phase === 'available', next.phase)
  check('available clears the skipped flag', next.skipped === false, String(next.skipped))
}

console.log('\nWindows: the signed manifest hash reaches the downloader:')
{
  let expected: string | undefined
  const native = {
    check: async (): Promise<string | null> => '0.2.0',
    download: async (
      _onProgress: (fraction: number) => void,
      _signal: AbortSignal,
      hash?: string
    ): Promise<void> => {
      expected = hash
    },
    install: (): void => undefined
  }
  const { updater } = build({
    native,
    latestRelease: async () => ({
      version: '0.2.0',
      url: 'https://example.test',
      artifacts: { 'Viby-windows-x64.exe': 'c'.repeat(64) }
    })
  })
  await updater.check()
  await updater.download()
  check('the manifest hash is passed through', expected === 'c'.repeat(64), expected)
}

console.log('\nWindows: a missing signed manifest blocks the update:')
{
  let downloaded = false
  const native = {
    check: async (): Promise<string | null> => '0.2.0',
    download: async (): Promise<void> => {
      downloaded = true
    },
    install: (): void => undefined
  }
  const { updater } = build({
    native,
    latestRelease: async () => ({ version: '0.2.0', url: 'https://example.test' })
  })
  const state = await updater.check()
  check('fails closed without an artifact hash', state.phase === 'error', state.phase)
  await updater.download()
  check('never downloads unsigned bytes', !downloaded)
}

console.log('\nWindows: a bad signature blocks the update:')
{
  const native = {
    check: async (): Promise<string | null> => '0.2.0',
    download: async (): Promise<void> => undefined,
    install: (): void => undefined
  }
  const { updater } = build({
    native,
    latestRelease: async () => {
      throw new UpdateIntegrityError('The update signature is invalid.')
    }
  })
  const state = await updater.check()
  check('the check fails', state.phase === 'error', state.phase)
  check('the reason is shown', /signature/.test(state.message ?? ''), state.message)
}

console.log('\nsigned update manifest:')
{
  const files = {
    'Viby-macos-arm.dmg': 'a'.repeat(64),
    'Viby-windows-x64.exe': 'b'.repeat(64)
  }
  check(
    'the app and the signing script agree on the payload',
    manifestPayload('0.2.0', files).equals(scriptManifestPayload('0.2.0', files))
  )

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyBase64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const signature = signManifest('0.2.0', files, pem)

  const verified = verifyManifest({ version: '0.2.0', files, signature }, publicKeyBase64)
  check('a valid manifest verifies', verified?.files['Viby-macos-arm.dmg'] === 'a'.repeat(64))

  const otherKey = generateKeyPairSync('ed25519').publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('base64')
  let foreign = false
  try {
    verifyManifest({ version: '0.2.0', files, signature }, otherKey)
  } catch {
    foreign = true
  }
  check('a signature from another key is rejected', foreign)

  let tampered = false
  try {
    verifyManifest(
      { version: '0.2.0', files: { ...files, 'Viby-macos-arm.dmg': 'd'.repeat(64) }, signature },
      publicKeyBase64
    )
  } catch {
    tampered = true
  }
  check('a tampered hash is rejected', tampered)

  let wrongVersion = false
  try {
    verifyManifest({ version: '0.3.0', files, signature }, publicKeyBase64)
  } catch {
    wrongVersion = true
  }
  check('a mismatched version is rejected', wrongVersion)

  let malformed = false
  try {
    verifyManifest({ version: '0.2.0', files: { x: 'nope' }, signature }, publicKeyBase64)
  } catch {
    malformed = true
  }
  check('malformed digests are rejected', malformed)

  check('no pinned key means no verification', verifyManifest({ version: '0.2.0', files, signature }, '') === null)
}

console.log('\nrelease feed parsing:')
{
  const assets = [
    {
      name: 'Viby-macos-arm.dmg',
      browser_download_url: 'https://example.test/Viby-macos-arm.dmg',
      digest: 'sha256:aa11'
    },
    {
      name: 'Viby-macos-intel.dmg',
      browser_download_url: 'https://example.test/Viby-macos-intel.dmg',
      digest: 'sha256:bb22'
    },
    {
      name: 'update-manifest.json',
      browser_download_url: 'https://example.test/update-manifest.json'
    }
  ]
  const payload = { tag_name: 'v0.2.0', html_url: 'https://example.test/v0.2.0', assets }

  const arm = releaseFromGithub(payload, 'arm64')
  check('version drops the tag prefix', arm.version === '0.2.0', arm.version)
  check('arm64 gets the arm DMG', arm.installerUrl?.endsWith('Viby-macos-arm.dmg') === true, arm.installerUrl)
  check('the digest is unwrapped', arm.installerSha256 === 'aa11', arm.installerSha256)

  const intel = releaseFromGithub(payload, 'x64')
  check('x64 gets the intel DMG', intel.installerUrl?.endsWith('Viby-macos-intel.dmg') === true, intel.installerUrl)
  check('the digest follows the asset', intel.installerSha256 === 'bb22', intel.installerSha256)
  check(
    'the signed manifest is located',
    arm.manifestUrl === 'https://example.test/update-manifest.json',
    arm.manifestUrl
  )

  const missing = releaseFromGithub({ tag_name: 'v0.2.0', html_url: 'u', assets: [] }, 'arm64')
  check('a missing asset leaves no installer', missing.installerUrl === undefined)
  check('a missing asset leaves no digest', missing.installerSha256 === undefined)

  const weirdDigest = releaseFromGithub(
    { tag_name: 'v0.2.0', html_url: 'u', assets: [{ name: 'Viby-macos-arm.dmg', digest: 'md5:cc33' }] },
    'arm64'
  )
  check('non-sha256 digests are ignored', weirdDigest.installerSha256 === undefined)

  const noAssets = releaseFromGithub({ tag_name: 'v0.2.0', html_url: 'u' }, 'arm64')
  check('a release without assets parses', noAssets.installerUrl === undefined)

  let threw = false
  try {
    releaseFromGithub({ nope: true }, 'arm64')
  } catch {
    threw = true
  }
  check('an unexpected payload throws', threw)
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
