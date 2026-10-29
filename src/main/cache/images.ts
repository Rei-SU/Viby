import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'
import { net } from 'electron'
import { mediaUrlFor } from '../media'
import { extensionFor } from '../image-extension'
import { isPrivateAddress } from '../private-address'

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_CACHE_BYTES = 256 * 1024 * 1024
const TIMEOUT_MS = 8_000
const EXTENSIONS = ['jpg', 'png', 'webp', 'gif'] as const

type FetchInit = { signal?: AbortSignal; redirect?: 'follow' | 'manual' | 'error' }
type FetchLike = (url: string, init?: FetchInit) => Promise<Response>

function isRemote(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/**
 * The cache is reachable from renderer-supplied URLs, so it must not become an
 * SSRF primitive into loopback, link-local or private network services.
 */
export async function assertSafeRemoteImageUrl(url: string): Promise<URL> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http(s) image URLs are supported')
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('Local image hosts are not allowed')
  }
  if (isIP(host) && isPrivateAddress(host)) throw new Error('Private image hosts are not allowed')
  if (!isIP(host)) {
    const addresses = await lookup(host, { all: true })
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new Error('Private image hosts are not allowed')
    }
  }
  return parsed
}

/**
 * Follow redirects manually so a public image URL cannot bounce the request
 * into loopback or a private network after the initial URL passed validation.
 */
export async function fetchSafeRemoteImage(url: string, init: FetchInit = {}): Promise<Response> {
  let current = url
  for (let hop = 0; hop < 6; hop++) {
    await assertSafeRemoteImageUrl(current)
    const res = await net.fetch(current, { ...init, redirect: 'manual' })
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
      throw new Error('Unsupported image redirect')
    }
    current = next.toString()
  }
  throw new Error('Too many image redirects')
}

const guardedFetch: FetchLike = (url, init) => fetchSafeRemoteImage(url, init)

/**
 * Artwork for the saved library, content-addressed and served over the media
 * scheme. Downloads have their own pinned art; this cache exists so a plain
 * playlist still shows covers and track thumbnails with no connection.
 *
 * It is deliberately separate from the audio cache: images are tiny, and
 * clearing cached audio should not wipe the library's offline covers.
 */
export class ImageCache {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly dir: string,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = fetchImpl ?? guardedFetch
    mkdirSync(dir, { recursive: true })
  }

  get path(): string {
    return this.dir
  }

  /** Exposed for tests and for checking a content-addressed file. */
  nameFor(url: string, ext: string): string {
    return `${createHash('sha1').update(url).digest('hex')}.${ext}`
  }

  /** A local URL for a cached image, or the original URL when it is already local. */
  localUrl(url: string | undefined): string | undefined {
    if (!url) return undefined
    if (!isRemote(url)) return url
    for (const ext of EXTENSIONS) {
      const file = join(this.dir, this.nameFor(url, ext))
      if (existsSync(file)) return mediaUrlFor(file)
    }
    return undefined
  }

  localMany(urls: string[]): Record<string, string> {
    const found: Record<string, string> = {}
    for (const url of urls) {
      const local = this.localUrl(url)
      if (local && local !== url) found[url] = local
    }
    return found
  }

  async cache(url: string | undefined, enforceCap = true): Promise<string | undefined> {
    if (!url) return undefined
    const local = this.localUrl(url)
    if (local) return local
    if (!isRemote(url)) return url

    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return undefined

      const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
      if (!contentType?.startsWith('image/')) return undefined
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > MAX_IMAGE_BYTES) return undefined

      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return undefined

      const ext = extensionFor(contentType, url)
      const dest = join(this.dir, this.nameFor(url, ext))
      if (!existsSync(dest)) {
        mkdirSync(this.dir, { recursive: true })
        const tmp = `${dest}.${process.pid}.part`
        try {
          writeFileSync(tmp, bytes)
          renameSync(tmp, dest)
        } catch (err) {
          rmSync(tmp, { force: true })
          throw err
        }
      }
      if (enforceCap) this.enforceCap()
      return mediaUrlFor(dest)
    } catch {
      // Artwork is decoration; a failure just leaves the remote URL in place.
      return undefined
    }
  }

  /** Cache many images with a small fixed concurrency, returning URL → local URL. */
  async cacheMany(urls: string[], concurrency = 4): Promise<Record<string, string>> {
    const unique = [...new Set(urls.filter((url) => typeof url === 'string' && isRemote(url)))]
      .slice(0, 250)
    const found = this.localMany(unique)
    const todo = unique.filter((url) => !found[url])

    let next = 0
    const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (next < todo.length) {
        const url = todo[next++]
        const local = await this.cache(url, false)
        if (local) found[url] = local
      }
    })
    await Promise.all(workers)
    // One directory scan per batch, not one per image. Skip it entirely when
    // every URL was already cached.
    if (todo.length > 0) this.enforceCap()
    return found
  }

  stats(): { bytes: number; entries: number } {
    let bytes = 0
    let entries = 0
    for (const name of this.files()) {
      try {
        bytes += statSync(join(this.dir, name)).size
        entries += 1
      } catch {
        // Removed between readdir and stat.
      }
    }
    return { bytes, entries }
  }

  clear(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true })
    } catch {
      // A renderer can still hold an image open on Windows. The next clear
      // (or launch) finishes the job; never turn Clear cache into an error.
    }
    mkdirSync(this.dir, { recursive: true })
  }

  private files(): string[] {
    try {
      return readdirSync(this.dir).filter((name) => !name.endsWith('.part'))
    } catch {
      return []
    }
  }

  /** Keep the cache bounded by dropping the oldest files first. */
  private enforceCap(): void {
    let total = this.stats().bytes
    if (total <= MAX_CACHE_BYTES) return

    const ordered = this.files()
      .map((name) => {
        const file = join(this.dir, name)
        try {
          const stat = statSync(file)
          return { file, size: stat.size, at: stat.mtimeMs }
        } catch {
          return null
        }
      })
      .filter((entry): entry is { file: string; size: number; at: number } => Boolean(entry))
      .sort((a, b) => a.at - b.at)

    for (const entry of ordered) {
      if (total <= MAX_CACHE_BYTES) break
      try {
        rmSync(entry.file, { force: true })
        total -= entry.size
      } catch {
        // Try the next one.
      }
    }
  }
}
