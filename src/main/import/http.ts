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
}

export async function httpGet(url: string, opts: RequestOptions = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  return fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en',
      ...opts.headers
    },
    signal
  })
}

export async function getText(url: string, opts: RequestOptions = {}): Promise<string> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  return res.text()
}

export async function getJson<T>(url: string, opts: RequestOptions = {}): Promise<T> {
  const res = await httpGet(url, opts)
  if (!res.ok) throw new ImportError(`The service returned HTTP ${res.status}`)
  try {
    return (await res.json()) as T
  } catch {
    throw new ImportError('The service returned an unreadable response')
  }
}
