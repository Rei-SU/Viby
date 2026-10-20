import { ImportError } from './errors'
import { httpGet } from './http'

export type DetectedImport = {
  service: 'spotify' | 'apple' | 'deezer' | 'youtube' | 'soundcloud'
  kind: 'playlist'
  /** Spotify/Deezer id, YouTube playlist id, or Apple/SoundCloud canonical URL. */
  id?: string
  url: string
  listId?: string
}

const SHORT_HOSTS = new Set([
  'spoti.fi',
  'apple.co',
  'deezer.page.link',
  'link.deezer.com',
  'on.soundcloud.com',
  'youtu.be',
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com'
])

const SUPPORTED =
  'Paste a playlist link from Spotify, Apple Music, Deezer, YouTube Music or SoundCloud.'

/** Follow short share links (and YouTube short links) to the canonical URL. */
async function followRedirect(input: string, signal?: AbortSignal): Promise<string> {
  const res = await httpGet(input, { signal, timeoutMs: 12_000 })
  const final = res.url || input
  try {
    await res.body?.cancel()
  } catch {
    // The body is irrelevant; cancelling is just polite.
  }
  return final
}

function spotify(url: URL): DetectedImport | null {
  if (!/(^|\.)(open|play)\.spotify\.com$/i.test(url.hostname)) return null
  const match = url.pathname.match(/\/playlist\/([A-Za-z0-9]{22})/)
  if (!match) {
    throw new ImportError(
      /^\/(album|track|artist)\//.test(url.pathname)
        ? 'That is a Spotify album or track link. Paste a playlist link instead.'
        : 'That Spotify link does not contain a playlist.'
    )
  }
  return {
    service: 'spotify',
    kind: 'playlist',
    id: match[1],
    url: `https://open.spotify.com/playlist/${match[1]}`
  }
}

function apple(url: URL): DetectedImport | null {
  if (!/(^|\.)music\.apple\.com$/i.test(url.hostname)) return null
  if (!/\/playlist\/.+\/pl\.[a-f0-9]+/i.test(url.pathname)) {
    throw new ImportError(
      /\/album\//i.test(url.pathname)
        ? 'That is an Apple Music album or track link. Paste a playlist link instead.'
        : 'That Apple Music link does not contain a playlist.'
    )
  }
  return { service: 'apple', kind: 'playlist', url: url.toString() }
}

function deezer(url: URL): DetectedImport | null {
  if (!/(^|\.)deezer\.com$/i.test(url.hostname)) return null
  const match = url.pathname.match(/\/playlist\/(\d+)/)
  if (!match) {
    throw new ImportError(
      /\/album\//i.test(url.pathname) || /\/track\//i.test(url.pathname)
        ? 'That is a Deezer album or track link. Paste a playlist link instead.'
        : 'That Deezer link does not contain a playlist.'
    )
  }
  return { service: 'deezer', kind: 'playlist', id: match[1], url: url.toString() }
}

function youtube(url: URL): DetectedImport | null {
  if (!/(^|\.)youtube\.com$/i.test(url.hostname) && url.hostname !== 'youtu.be') return null
  const list = url.searchParams.get('list')
  if (!list) {
    throw new ImportError(
      url.hostname === 'youtu.be' || url.searchParams.get('v')
        ? 'That is a single video. Paste a YouTube Music playlist link instead.'
        : 'That YouTube link does not contain a playlist.'
    )
  }
  if (list.startsWith('RD')) {
    throw new ImportError('That is an endless radio mix. Paste a normal playlist instead.')
  }
  if (list.startsWith('LL') || list.startsWith('WL')) {
    throw new ImportError('That playlist is private. Make it public, then paste the link again.')
  }
  return {
    service: 'youtube',
    kind: 'playlist',
    id: list,
    listId: list,
    url: `https://music.youtube.com/playlist?list=${encodeURIComponent(list)}`
  }
}

function soundcloud(url: URL): DetectedImport | null {
  if (!/(^|\.)soundcloud\.com$/i.test(url.hostname)) return null
  if (!/\/sets\//i.test(url.pathname)) {
    throw new ImportError(
      'That is a SoundCloud track. Paste a SoundCloud playlist (set) link instead.'
    )
  }
  return { service: 'soundcloud', kind: 'playlist', url: url.toString() }
}

/**
 * Detect the service, kind and canonical URL of a pasted playlist link.
 * Short share links are followed once, then detected again.
 */
export async function detectImportUrl(
  input: string,
  signal?: AbortSignal
): Promise<DetectedImport> {
  const value = input.trim()
  if (!value) throw new ImportError('Paste a playlist link first')

  const spotifyUri = value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/)
  if (spotifyUri) {
    return {
      service: 'spotify',
      kind: 'playlist',
      id: spotifyUri[1],
      url: `https://open.spotify.com/playlist/${spotifyUri[1]}`
    }
  }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ImportError(SUPPORTED)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImportError(SUPPORTED)
  }

  const host = url.hostname.toLowerCase()
  if (SHORT_HOSTS.has(host) && !host.includes('youtube.com')) {
    const final = await followRedirect(url.toString(), signal)
    if (final === url.toString()) {
      throw new ImportError('That short link could not be resolved. Paste the full share link.')
    }
    return detectImportUrl(final, signal)
  }

  return (
    spotify(url) ??
    apple(url) ??
    deezer(url) ??
    youtube(url) ??
    soundcloud(url) ??
    (() => {
      throw new ImportError(SUPPORTED)
    })()
  )
}
