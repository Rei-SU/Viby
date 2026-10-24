import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { ImportError } from './errors'

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36'

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type RequestOptions = {
  signal?: AbortSignal
  headers?: Record<string, string>
  timeoutMs?: number
  redirect?: 'follow' | 'manual' | 'error'
}

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) {
    const [a, b] = address.split('.').map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  if (family === 6) {
    const lower = address.toLowerCase()
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7))
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    )
  }
  return true
}

/** Reject loopback/private targets before a server-side request can reach them. */
export async function assertPublicHttpUrl(input: string): Promise<URL> {
  const url = new URL(input)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ImportError('Only http(s) links are supported')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ImportError('Local links are not supported')
  }
  if (isIP(host) && isPrivateAddress(host)) throw new ImportError('Local links are not supported')
  if (!isIP(host)) {
    let addresses: Array<{ address: string }>
    try {
      addresses = await lookup(host, { all: true })
    } catch {
      throw new ImportError('That link could not be resolved')
    }
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new ImportError('Local links are not supported')
    }
  }
  return url
}

export async function httpGet(url: string, opts: RequestOptions = {}): Promise<Response> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept-Language': 'en',
          ...opts.headers
        },
        redirect: opts.redirect,
        signal
      })
      if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
        try {
          await res.body?.cancel()
        } catch {
          // The body is irrelevant.
        }
        await sleep(250 * 2 ** attempt)
        continue
      }
      return res
    } catch (error) {
      lastError = error
      if (opts.signal?.aborted) throw error
      if (attempt === MAX_ATTEMPTS - 1) throw error
      await sleep(250 * 2 ** attempt)
    }
  }
  throw lastError ?? new ImportError('The service did not respond')
}

function ensureBounded(res: Response): void {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new ImportError('The service returned an unexpectedly large response')
  }
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  ensureBounded(res)
  const text = await res.text()
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ImportError('The service returned an unexpectedly large response')
  }
  return text
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  ensureBounded(res)
  try {
    return (await res.json()) as T
  } catch {
    throw new ImportError('The service returned an unreadable response')
  }
}
