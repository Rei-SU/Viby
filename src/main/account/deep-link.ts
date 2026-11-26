import { resolve } from 'node:path'
import { app } from 'electron'

/**
 * `viby://auth/callback` plumbing.
 *
 * macOS delivers a custom-scheme URL through `open-url`; Windows and Linux
 * start a second copy of the app with the URL in argv, and the single-instance
 * lock relays that argv to the running process. Both paths end in the same
 * handler, and links that arrive before the handler exists are queued rather
 * than dropped.
 */

const SCHEME = 'viby'
const PREFIX = `${SCHEME}://`

let handler: ((url: string) => void) | null = null
const queued: string[] = []
let installed = false

/** The first custom-scheme URL in an argv list, if any. */
export function findProtocolUrl(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith(PREFIX)) return arg
  }
  return null
}

function dispatch(url: string): void {
  if (handler) handler(url)
  else queued.push(url)
}

function registerProtocol(): void {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      // Development: electron.exe (or the packaged binary) plus the app path.
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient(SCHEME)
    }
  } catch {
    // A portable or store-managed build may forbid registry writes. The link
    // still works when the OS already routes the scheme here.
  }
}

/**
 * Register the scheme and the macOS event, then hand every pending URL to
 * `onUrl`. Call once, early in the main entry point.
 */
export function installDeepLinks(onUrl: (url: string) => void): void {
  handler = onUrl
  if (!installed) {
    installed = true
    app.on('open-url', (event, url) => {
      event.preventDefault()
      dispatch(url)
    })
    void app.whenReady().then(registerProtocol)
  }
  for (const url of queued.splice(0)) onUrl(url)
}

/** Feed a process argv list (startup, or a second instance) through the handler. */
export function handleProtocolArgs(argv: readonly string[]): void {
  const url = findProtocolUrl(argv)
  if (url) dispatch(url)
}
