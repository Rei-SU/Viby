/**
 * Update state machine with injected platform adapters. No Electron, no
 * network. Run:
 *   node tests/unit.mjs updates
 */
import type { UpdateState } from '../src/shared/types'
import { Updater, type ReleaseInfo, type UpdaterDeps } from '../src/main/updater'

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
      url: 'https://example.test/v0.2.0'
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
  const { updater, states } = build({ native })
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
  const { updater } = build({ native })
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
      return { version: '0.2.0', url: 'https://example.test' }
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

console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
