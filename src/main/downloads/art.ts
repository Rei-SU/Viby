import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchSafeRemoteImage } from '../cache/images'
import { extensionFor } from '../image-extension'
import type { DownloadsStore } from './store'

const MAX_ART_BYTES = 6 * 1024 * 1024
const ART_TIMEOUT_MS = 8_000

/**
 * Cache cover art locally while the download runs. Offline screens with remote
 * thumbnail URLs would otherwise be a grid of placeholders.
 */
export async function fetchArt(url: string | undefined, store: DownloadsStore): Promise<string | null> {
  if (!url) return null

  // Already downloaded under a previous extension? Hash is URL-based, so check
  // the likely names before making a request.
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    const name = store.artNameFor(url, ext)
    if (existsSync(join(store.dir, name))) return name
  }

  try {
    const res = await fetchSafeRemoteImage(url, {
      signal: AbortSignal.timeout(ART_TIMEOUT_MS)
    })
    if (!res.ok) return null

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (!contentType?.startsWith('image/')) return null
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > MAX_ART_BYTES) return null

    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ART_BYTES) return null

    const ext = extensionFor(contentType, url)
    const name = store.artNameFor(url, ext)
    const dest = join(store.dir, name)
    if (existsSync(dest)) return name

    mkdirSync(store.artDir, { recursive: true })
    const tmp = `${dest}.part`
    try {
      writeFileSync(tmp, bytes)
      renameSync(tmp, dest)
    } catch (err) {
      rmSync(tmp, { force: true })
      throw err
    }
    return name
  } catch {
    // Artwork is decoration: a failure must never fail the download.
    return null
  }
}
