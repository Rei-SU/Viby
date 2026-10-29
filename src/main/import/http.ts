import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import {
  OversizedBodyError,
  readBoundedText
} from '../bounded-body'
import { isPrivateAddress } from '../private-address'
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

const MAX_REDIRECTS = 5
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

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
      const res = await fetchGuarded(url, opts, signal)
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
      // A rejected URL is a policy decision, not a transient network failure.
      if (error instanceof ImportError) throw error
      lastError = error
      if (opts.signal?.aborted) throw error
      if (attempt === MAX_ATTEMPTS - 1) throw error
      await sleep(250 * 2 ** attempt)
    }
  }
  throw lastError ?? new ImportError('The service did not respond')
}

/**
 * Every hop is re-checked before it is fetched: a public URL must not be able
 * to redirect the main process into loopback or a private network.
 */
async function fetchGuarded(
  url: string,
  opts: RequestOptions,
  signal: AbortSignal
): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpUrl(current)
    const res = await fetch(current, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en',
        ...opts.headers
      },
      redirect:
        opts.redirect === 'manual' || opts.redirect === 'error' ? opts.redirect : 'manual',
      signal
    })
    if (opts.redirect === 'manual' || opts.redirect === 'error') return res
    if (res.status < 300 || res.status >= 400) return res

    const location = res.headers.get('location')
    try {
      await res.body?.cancel()
    } catch {
      // The redirect body is irrelevant.
    }
    if (!location) return res

    const next = new URL(location, current)
    if (next.protocol !== 'https:' && next.protocol !== 'http:') {
      throw new ImportError('That link redirected somewhere unsupported')
    }
    current = next.toString()
  }
  throw new ImportError('That link redirected too many times')
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  try {
    return await readBoundedText(res)
  } catch (error) {
    if (error instanceof OversizedBodyError) {
      throw new ImportError('The service returned an unexpectedly large response')
    }
    throw error
  }
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  let text: string
  try {
    text = await readBoundedText(res)
  } catch (error) {
    if (error instanceof OversizedBodyError) {
      throw new ImportError('The service returned an unexpectedly large response')
    }
    throw error
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ImportError('The service returned an unreadable response')
  }
}
