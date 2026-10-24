#!/usr/bin/env node
/**
 * Vendors a relocatable CPython (python-build-standalone) into
 * `resources/python/<os>-<arch>` so a shipped Viby never needs a system Python.
 *
 * yt-dlp itself stays a 3 MB zipapp that can self-update; only the interpreter
 * is frozen into the package. Extracted copies start in ~0.2–0.6 s, versus
 * 20 s+ for the PyInstaller macOS binary (Gatekeeper re-assesses it every run).
 *
 *   node scripts/fetch-runtime.mjs                 # host platform/arch
 *   node scripts/fetch-runtime.mjs --arch arm64
 *   node scripts/fetch-runtime.mjs --force         # re-download
 *
 * Assets are pinned to a known release; bump RELEASE/VERSION deliberately.
 */
import { execFileSync } from 'node:child_process'
import {
  closeSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const RELEASE = '20261013'
const PYTHON = '3.12.15'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const platform = option('platform', process.platform)
const arch = option('arch', process.arch)
const force = args.includes('--force')

const osName = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform
const assetArch = arch === 'arm64' ? 'aarch64' : 'x86_64'
const suffix =
  platform === 'darwin'
    ? 'apple-darwin-install_only.tar.gz'
    : platform === 'win32'
      ? 'pc-windows-msvc-install_only_stripped.tar.gz' // no .pdb debug symbols
      : 'unknown-linux-gnu-install_only.tar.gz'

const asset = `cpython-${PYTHON}+${RELEASE}-${assetArch}-${suffix}`
const url = `https://github.com/astral-sh/python-build-standalone/releases/download/${RELEASE}/${asset.replace('+', '%2B')}`

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(projectRoot, 'resources', 'python', `${osName}-${arch}`)
const executable = platform === 'win32' ? join(dest, 'python.exe') : join(dest, 'bin', 'python3')

await vendorZipapp()

if (existsSync(executable) && !force) {
  console.log(`runtime already vendored: resources/python/${osName}-${arch}`)
  process.exit(0)
}

console.log(`fetching ${asset}`)
const response = await fetch(url, {
  redirect: 'follow',
  headers: { 'User-Agent': 'Viby/0.1 (+https://github.com/viby)' }
})
if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`)

const work = mkdtempSync(join(tmpdir(), 'viby-python-'))
const archive = join(work, 'python.tar.gz')

try {
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))

  console.log('extracting')
  execFileSync('tar', ['-xzf', archive, '-C', work], { stdio: 'inherit' })

  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(join(work, 'python'), dest, { recursive: true })
  // cpSync rewrites relative symlinks to absolute paths into the temp dir.
  if (platform !== 'win32') {
    const bin = join(dest, 'bin')
    const interpreter = `python${PYTHON.split('.').slice(0, 2).join('.')}`
    for (const name of ['python', 'python3']) {
      rmSync(join(bin, name), { force: true })
      symlinkSync(interpreter, join(bin, name))
    }
  }

  trim(dest, platform, PYTHON)

  // Apple Silicon refuses entirely unsigned code, and these builds are shipped
  // unsigned. Ad-hoc signing is free and keeps the runtime launchable. A plain
  // directory is not a bundle, so sign every Mach-O file individually.
  if (platform === 'darwin') {
    const signed = signMachOFiles(dest)
    console.log(`ad-hoc signed ${signed} file(s)`)
  }

  if (platform === process.platform && arch === process.arch) {
    execFileSync(executable, ['--version'], { stdio: 'inherit' })
  }

  console.log(`vendored resources/python/${osName}-${arch}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

/**
 * yt-dlp itself: 3MB, gives a fresh install a working copy before any network
 * call. It still self-updates into userData afterwards.
 */
async function vendorZipapp() {
  const zipapp = join(projectRoot, 'resources', 'bin', 'yt-dlp.pyz')
  if (existsSync(zipapp) && !force) return

  console.log('fetching yt-dlp zipapp')
  mkdirSync(dirname(zipapp), { recursive: true })
  const release = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', {
    redirect: 'follow',
    headers: { 'User-Agent': 'Viby/0.1 (+https://github.com/viby)' }
  })
  if (!release.ok || !release.body) throw new Error(`HTTP ${release.status} for yt-dlp`)

  await pipeline(Readable.fromWeb(release.body), createWriteStream(`${zipapp}.download`))
  renameSync(`${zipapp}.download`, zipapp)
}

function signMachOFiles(root) {
  let count = 0
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile() && isMachO(path)) {
        try {
          execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', path], {
            stdio: 'ignore'
          })
          count++
        } catch {
          // Not fatal here; the launch check below will catch a broken runtime.
        }
      }
    }
  }
  return count
}

function isMachO(path) {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(4)
    readSync(fd, head, 0, 4, 0)
    const magic = head.readUInt32BE(0)
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(magic)
  } finally {
    closeSync(fd)
  }
}

/** Drop parts of the stdlib a headless audio extractor will never import. */
function trim(root, targetPlatform, version) {
  // Windows keeps the stdlib directly under `Lib/` (capitalised) instead of
  // `lib/pythonX.Y/`. Point at the right place so the trim actually fires.
  const isWin = targetPlatform === 'win32'
  const lib = isWin
    ? join(root, 'Lib')
    : join(root, 'lib', `python${version.split('.').slice(0, 2).join('.')}`)
  const drop = [
    join(lib, 'idlelib'),
    join(lib, 'tkinter'),
    join(lib, 'ensurepip'),
    join(lib, 'lib2to3'),
    join(lib, 'pydoc_data'),
    join(lib, 'turtledemo'),
    join(lib, 'test'),
    join(lib, 'tests'),
    join(lib, 'site-packages', 'pip'),
    join(lib, 'site-packages', 'pip-*.dist-info'),
    join(lib, 'site-packages', 'setuptools'),
    join(lib, 'site-packages', 'setuptools-*.dist-info'),
    join(lib, 'site-packages', 'pkg_resources'),
    join(lib, 'site-packages', '_distutils_hack'),
    join(lib, 'site-packages', 'distutils-precedence.pth'),
    join(root, 'include'),
    join(root, 'share')
  ]
  // Windows-only extras a headless audio extractor never imports.
  if (isWin) {
    drop.push(join(root, 'tcl'), join(root, 'Tools'), join(root, 'Doc'))
  }

  for (const path of drop) {
    // Simple glob support for the *.dist-info directories.
    if (path.includes('*')) {
      const dir = dirname(path)
      const needle = path.slice(dir.length + 1).replace('*', '')
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir)) {
        if (entry.startsWith(needle)) rmSync(join(dir, entry), { recursive: true, force: true })
      }
    } else {
      rmSync(path, { recursive: true, force: true })
    }
  }

  if (targetPlatform === 'win32') {
    rmSync(join(root, 'Scripts'), { recursive: true, force: true })
    rmSync(join(root, 'pythonw.exe'), { force: true })
  } else {
    for (const name of ['2to3', '2to3-3.12', 'idle3', 'idle3.12', 'pip', 'pip3', 'pip3.12', 'pydoc3', 'pydoc3.12', 'python3-config', 'python3.12-config']) {
      rmSync(join(root, 'bin', name), { recursive: true, force: true })
    }
  }
}
