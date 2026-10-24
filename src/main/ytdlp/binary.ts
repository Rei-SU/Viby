import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { delimiter, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { YtDlpInfo } from '@shared/types'
import { run } from './exec'

/**
 * yt-dlp provisioning (PLAN §2.3).
 *
 * Shipping contract: the user installs Viby and plays. They never install
 * Python, run a setup screen, or wait for a PyInstaller blob to be re-assessed.
 *
 * - **Bundled CPython + zipapp** (the shipping path): a relocatable interpreter
 *   vendored into `resources/python/<os>-<arch>` runs the extracted yt-dlp source
 *   in ~0.2–0.6s. yt-dlp itself stays a 3MB zipapp so it can self-update.
 * - **System Python** (development only): a fallback when the runtime has not
 *   been fetched yet.
 * - **PyInstaller binary** (last resort): macOS Gatekeeper re-assesses the
 *   ad-hoc-signed 35MB blob on every launch — measured at 20s+ for `--version`.
 *   It exists so the app degrades instead of dying, not as a supported path.
 */

export type Runner = {
  /** Executable to spawn. */
  command: string
  /** Arguments that must come before yt-dlp's own arguments. */
  prefix: string[]
  /** Where the actual yt-dlp code lives. */
  path: string
  kind: 'zipapp' | 'binary'
  /** Which interpreter is running yt-dlp; `binary` means the frozen fallback. */
  runtime: 'bundled' | 'system' | 'binary'
  /** Set when the zipapp has been unpacked into a directory (keeps __pycache__). */
  extractedDir?: string
  /** The zipapp backing this runner, used to update it. */
  zipapp?: string
}

const IS_WINDOWS = process.platform === 'win32'
/** electron-builder macro naming for the vendored runtime directory. */
const RUNTIME_OS =
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : process.platform
const BIN_NAME = IS_WINDOWS ? 'yt-dlp.exe' : 'yt-dlp'
const ZIPAPP_NAME = 'yt-dlp.pyz'
const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'

const RELEASE_ASSET: Record<string, string> = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: 'yt-dlp_linux'
}

function binDir(): string {
  return join(app.getPath('userData'), 'bin')
}

function resourcesBinDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

export function pluginsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'yt-dlp-plugins')
    : join(app.getAppPath(), 'resources', 'yt-dlp-plugins')
}

export function managedBinaryPath(): string {
  return join(binDir(), BIN_NAME)
}

export function managedZipappPath(): string {
  return join(binDir(), ZIPAPP_NAME)
}

let provisioning: Promise<Runner> | null = null

/**
 * Idempotent: resolves the runner once per launch. Called eagerly at startup so
 * the cost is paid while the user is still browsing, not on their first click.
 */
export function ensureRunner(): Promise<Runner> {
  if (!provisioning) {
    provisioning = provision().catch((err) => {
      provisioning = null
      throw err
    })
  }
  return provisioning
}

async function provision(): Promise<Runner> {
  mkdirSync(binDir(), { recursive: true })

  const interpreters: { command: string; runtime: 'bundled' | 'system' }[] = []
  const bundled = bundledPython()
  if (bundled) interpreters.push({ command: bundled, runtime: 'bundled' })
  const system = findPython()
  if (system && system !== bundled) interpreters.push({ command: system, runtime: 'system' })

  if (interpreters.length > 0) {
    // yt-dlp is pure stdlib. Keep its output byte-for-byte UTF-8 (Windows pipes
    // default to the ANSI code page) and give the interpreter a writable
    // bytecode cache even when the runtime lives inside a read-only app bundle.
    process.env.PYTHONUTF8 = '1'
    process.env.PYTHONIOENCODING = 'utf-8'
    process.env.PYTHONPYCACHEPREFIX ??= join(app.getPath('userData'), 'pycache')

    for (const { command, runtime } of interpreters) {
      const extracted = await ensureExtracted(command)
      if (extracted && (await works(command, extracted.entry))) {
        return {
          command,
          prefix: [extracted.entry],
          path: extracted.entry,
          kind: 'zipapp',
          runtime,
          extractedDir: extracted.dir,
          zipapp: extracted.zipapp
        }
      }

      // An old Python or a broken extraction must not be fatal: try the zipapp
      // directly before giving up on the fast path.
      try {
        const zipapp = await ensureZipapp(managedZipappPath())
        if (await works(command, zipapp)) {
          return { command, prefix: [zipapp], path: zipapp, kind: 'zipapp', runtime, zipapp }
        }
      } catch {
        // Try the next interpreter, then the binary.
      }
    }
  }

  const binary = await ensureBinaryFile()
  return { command: binary, prefix: [], path: binary, kind: 'binary', runtime: 'binary' }
}

/**
 * The interpreter shipped inside the app. In development it comes from
 * `resources/python/<os>-<arch>` (run `node scripts/fetch-runtime.mjs` once).
 */
function bundledPython(): string | null {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'python')
    : join(app.getAppPath(), 'resources', 'python', `${RUNTIME_OS}-${process.arch}`)
  const executable = IS_WINDOWS ? join(root, 'python.exe') : join(root, 'bin', 'python3')
  return isExecutable(executable) ? executable : null
}

/**
 * Unpack the zipapp once.
 *
 * A zipapp recompiles its modules on every single run (~1.9s just for
 * `--version`); an extracted copy keeps `__pycache__` and starts in ~0.6s. That
 * 1.3s is the difference between "click to audio" feeling slow and feeling
 * instant, so it is worth the one-time unpack at startup.
 */
async function ensureExtracted(
  python: string
): Promise<{ dir: string; entry: string; zipapp: string } | null> {
  const dir = join(binDir(), 'yt-dlp-src')
  const entry = join(dir, '__main__.py')
  const zipapp = managedZipappPath()

  if (existsSync(entry)) return { dir, entry, zipapp }

  try {
    await ensureZipapp(zipapp)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const { code, stderr } = await run(python, ['-m', 'zipfile', '-e', zipapp, dir], {
      timeoutMs: 120_000
    })
    if (code !== 0) throw new Error(stderr.trim() || 'Could not unpack yt-dlp')
    return existsSync(entry) ? { dir, entry, zipapp } : null
  } catch {
    return null
  }
}

async function ensureZipapp(dest: string): Promise<string> {
  if (existsSync(dest) && statSync(dest).size > 1_000_000) return dest

  // A bundled copy lets a packaged app work before it ever reaches the network.
  const bundled = join(resourcesBinDir(), ZIPAPP_NAME)
  if (existsSync(bundled)) {
    copyFileSync(bundled, dest)
    return dest
  }

  await download(`${RELEASE_BASE}/yt-dlp`, dest)
  return dest
}

async function ensureBinaryFile(): Promise<string> {
  const dest = managedBinaryPath()
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    makeExecutable(dest)
    return dest
  }

  const bundled = join(resourcesBinDir(), BIN_NAME)
  if (existsSync(bundled)) {
    copyFileSync(bundled, dest)
    makeExecutable(dest)
    return dest
  }

  await download(`${RELEASE_BASE}/${RELEASE_ASSET[process.platform] ?? RELEASE_ASSET.darwin}`, dest)
  makeExecutable(dest)
  return dest
}

const MAX_BINARY_BYTES = 250 * 1024 * 1024

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Viby/0.1 (+https://github.com/viby)' },
    signal: AbortSignal.timeout(120_000)
  })
  if (!res.ok || !res.body) {
    throw new Error(`Could not download yt-dlp (HTTP ${res.status}). Check your connection.`)
  }

  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BINARY_BYTES) throw new Error('yt-dlp download is unexpectedly large.')

  let total = 0
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      if (total > MAX_BINARY_BYTES) {
        callback(new Error('yt-dlp download is unexpectedly large.'))
        return
      }
      callback(null, chunk)
    }
  })

  const tmp = `${dest}.download`
  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      limit,
      createWriteStream(tmp)
    )
    renameSync(tmp, dest)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

function makeExecutable(file: string): void {
  if (!IS_WINDOWS) chmodSync(file, 0o755)
}

/** A runner is only useful if it actually executes and looks like a date-stamped version. */
async function works(command: string, script: string): Promise<boolean> {
  try {
    const { code, stdout } = await run(command, [script, '--version'], { timeoutMs: 60_000 })
    return code === 0 && /^\d{4}\.\d{2}\.\d{2}/.test(stdout.trim())
  } catch {
    return false
  }
}

/**
 * Find a Python 3 we can execute. Version support is validated by actually
 * running the zipapp, so a stale or broken interpreter falls back cleanly.
 */
function findPython(): string | null {
  const names = IS_WINDOWS ? ['python.exe', 'python3.exe'] : ['python3', 'python']
  const fromPath: string[] = []
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)

  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      if (isExecutable(candidate)) {
        fromPath.push(candidate)
        break
      }
    }
  }

  const fallbacks =
    process.platform === 'darwin'
      ? [
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
          '/usr/bin/python3',
          '/Library/Frameworks/Python.framework/Versions/Current/bin/python3'
        ]
      : []

  return [...fromPath, ...fallbacks].find(isExecutable) ?? null
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Plugins (PO-token providers) are optional; only pass the flag if any exist. */
export function pluginArgs(): string[] {
  const dir = pluginsDir()
  if (!existsSync(dir)) return []
  return ['--plugin-dirs', dir]
}

let cachedVersion: string | null = null

export async function runnerInfo(): Promise<YtDlpInfo> {
  const runner = await ensureRunner()

  if (!cachedVersion) {
    const { code, stdout, stderr } = await run(
      runner.command,
      [...runner.prefix, '--version'],
      { timeoutMs: 60_000 }
    )
    if (code !== 0) throw new Error(stderr.trim() || 'Could not read the yt-dlp version')
    cachedVersion = stdout.trim()
  }

  return { path: runner.path, version: cachedVersion, kind: runner.kind, runtime: runner.runtime }
}

/**
 * Update in place. The zipapp is re-downloaded (3MB, deterministic) rather than
 * asking `-U` to rewrite the file it is currently executing.
 */
export async function updateRunner(): Promise<YtDlpInfo> {
  const runner = await ensureRunner()

  if (runner.kind === 'zipapp') {
    const zipapp = runner.zipapp ?? runner.path
    await download(`${RELEASE_BASE}/yt-dlp`, zipapp)

    if (runner.extractedDir) {
      rmSync(runner.extractedDir, { recursive: true, force: true })
      mkdirSync(runner.extractedDir, { recursive: true })
      const { code, stderr } = await run(
        runner.command,
        ['-m', 'zipfile', '-e', zipapp, runner.extractedDir],
        { timeoutMs: 120_000 }
      )
      if (code !== 0) throw new Error(stderr.trim() || 'Could not unpack yt-dlp')
    }
  } else {
    const { code, stdout, stderr } = await run(
      runner.command,
      [...runner.prefix, '-U'],
      { timeoutMs: 180_000 }
    )
    if (code !== 0) throw new Error((stderr || stdout).trim() || 'yt-dlp update failed')
  }

  cachedVersion = null
  return runnerInfo()
}
