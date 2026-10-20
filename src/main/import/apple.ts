import type { ImportSource, ImportTrack } from '@shared/types'
import { ImportError } from './errors'
import { getText } from './http'

type AppleTrack = {
  title?: string
  artistName?: string
  duration?: number
  trackNumber?: number
  isDisabled?: boolean
  showExplicitBadge?: boolean
  tertiaryLinks?: Array<{ title?: string }>
  contentDescriptor?: {
    kind?: string
    url?: string
    identifiers?: { storeAdamID?: string }
  }
}

type AppleHeader = {
  title?: string
  trackCount?: number
  artwork?: { dictionary?: { url?: string } }
}

type AppleSection = {
  id?: string
  itemKind?: string
  items?: unknown[]
}

function meta(html: string, key: string): string | undefined {
  const before = new RegExp(`<meta[^>]+(?:property|name)="${key}"[^>]+content="([^"]*)"`, 'i')
  const after = new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${key}"`, 'i')
  return html.match(before)?.[1] ?? html.match(after)?.[1]
}

function albumOf(track: AppleTrack): string | undefined {
  const raw = track.tertiaryLinks?.[0]?.title
  return raw?.replace(/\s+-\s+(?:Single|EP)$/i, '').trim() || undefined
}

function toTrack(track: AppleTrack): ImportTrack | null {
  if (!track.title || track.contentDescriptor?.kind !== 'song') return null
  const id = track.contentDescriptor.identifiers?.storeAdamID
  return {
    title: track.title,
    artists: track.artistName ? [track.artistName] : [],
    album: albumOf(track),
    durationSec: typeof track.duration === 'number' ? Math.round(track.duration / 1000) : undefined,
    explicit: track.showExplicitBadge === true,
    available: track.isDisabled !== true,
    sourceId: id ? String(id) : undefined,
    sourceUrl:
      track.contentDescriptor.url ??
      (id ? `https://music.apple.com/us/song/${id}` : undefined)
  }
}

export async function resolveApple(url: string, signal?: AbortSignal): Promise<ImportSource> {
  const html = await getText(url, { signal })
  const match = html.match(
    /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/
  )
  if (!match) throw new ImportError('Could not read this Apple Music playlist')

  let data: { data?: Array<{ data?: { sections?: AppleSection[] } }> }
  try {
    data = JSON.parse(match[1])
  } catch {
    throw new ImportError('Could not read this Apple Music playlist')
  }

  const sections = data.data?.[0]?.data?.sections ?? []
  const trackSection = sections.find(
    (section) => section.itemKind === 'trackLockup' || /^track-list/.test(section.id ?? '')
  )
  const items = (trackSection?.items ?? []) as AppleTrack[]
  const tracks = items.map(toTrack).filter((track): track is ImportTrack => Boolean(track))

  if (tracks.length === 0) {
    throw new ImportError('This Apple Music playlist has no readable tracks')
  }

  const header = sections.find((section) => section.itemKind === 'containerDetailHeaderLockup')
    ?.items?.[0] as AppleHeader | undefined
  const ogTitle = meta(html, 'og:title')?.replace(/\s+on Apple Music$/i, '').trim()
  const cover =
    meta(html, 'og:image') ??
    header?.artwork?.dictionary?.url?.replace('{w}x{h}bb.{f}', '600x600bb.png')

  return {
    service: 'apple',
    kind: 'playlist',
    url,
    title: header?.title ?? ogTitle ?? 'Apple Music playlist',
    creator: 'Apple Music',
    cover,
    totalTracks: header?.trackCount ?? tracks.length,
    tracks
  }
}
