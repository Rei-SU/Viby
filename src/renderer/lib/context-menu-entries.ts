import type { CatalogItem, SavedAlbum, Track } from '@shared/types'
import { toTrack, player } from './player.svelte'
import { favorites } from './favorites.svelte'
import { downloads } from './downloads.svelte'
import { savedAlbums } from './saved-albums.svelte'
import { playlists } from './playlists.svelte'
import { playlistPicker } from './playlist-picker.svelte'
import { toast } from './toast.svelte'
import { nav } from './nav.svelte'
import { network } from './network.svelte'
import { openArtist } from './artist'
import { openTrackTarget } from './release'
import { itemArtist, loadCollection } from './collection-tracks'
import type { MenuAction, MenuEntry, MenuIcon, MenuSubmenu } from './context-menu.svelte'

export type ContextSubject = {
  item: CatalogItem
  /** The list the row belongs to, so Play starts in context. */
  context?: CatalogItem[]
  index?: number
  /** Queue rows play their own slot instead of replacing the queue. */
  play?: () => void | Promise<void>
  onRemove?: () => void | Promise<void>
  removeLabel?: string
  /** Fallback for release cards that dropped their credits (artist pages). */
  artist?: { name: string; id?: string }
}

function action(
  label: string,
  icon: MenuIcon | undefined,
  run: () => void | Promise<void>,
  extra: Pick<MenuAction, 'disabled' | 'danger'> = {}
): MenuAction {
  return { type: 'action', label, icon, run, ...extra }
}

const separator = (): MenuEntry => ({ type: 'separator' })

/** A separator only between real groups, never leading or trailing. */
function grouped(entries: Array<MenuEntry | null>): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const entry of entries) {
    if (!entry) continue
    if (entry.type === 'separator') {
      if (out.length === 0 || out[out.length - 1]?.type === 'separator') continue
    }
    out.push(entry)
  }
  while (out[out.length - 1]?.type === 'separator') out.pop()
  return out
}

function playNext(item: CatalogItem): void {
  if (player.queue.length === 0 || player.index < 0) {
    void player.playItem(item)
    return
  }
  player.insertAt(player.index + 1, item)
  toast.show(`Playing ${item.title} next`)
}

async function addTracksToPlaylist(
  playlistId: string,
  name: string,
  tracks: Track[]
): Promise<void> {
  for (const track of tracks) {
    await playlists.addTrack(playlistId, track)
  }
  toast.show(tracks.length === 1 ? `Added to ${name}` : `Added ${tracks.length} songs to ${name}`)
}

/**
 * Add to playlist is a hover flyout, Spotify-style: search, Create playlist,
 * then the playlists themselves. Release tracks load only when an entry is
 * chosen, so merely hovering the menu stays instant.
 */
function playlistSubmenu(
  anchor: HTMLElement,
  load: () => Promise<Track[] | null>
): MenuSubmenu {
  void playlists.load()
  return {
    type: 'submenu',
    label: 'Add to playlist',
    icon: 'plus',
    search: true,
    create: action('New playlist', 'plus', async () => {
      const tracks = await load()
      if (tracks?.length) playlistPicker.showNew(tracks, anchor)
    }),
    items: () =>
      playlists.items.length === 0
        ? [action('No playlists yet', undefined, () => undefined, { disabled: true })]
        : playlists.items.map((playlist) =>
            action(playlist.name, undefined, async () => {
              const tracks = await load()
              if (!tracks?.length) return
              await addTracksToPlaylist(playlist.id, playlist.name, tracks)
            })
          )
  }
}

function albumLink(item: CatalogItem): { id?: string; title?: string } {
  const part = item.parts?.find((entry) => entry.albumId || entry.entity === 'album')
  return {
    id: item.albumId ?? part?.albumId,
    title: item.album?.trim() || part?.text.trim() || undefined
  }
}

function goToAlbum(item: CatalogItem): void {
  const album = albumLink(item)
  if (album.id) {
    nav.open({
      id: album.id,
      browseId: album.id,
      kind: 'album',
      title: album.title ?? 'Album',
      subtitle: 'Album',
      thumbnail: item.thumbnail
    })
    return
  }
  // No tagged release: the title navigation already knows how to discover it.
  void openTrackTarget(toTrack(item))
}

function songDownload(item: CatalogItem): MenuEntry | null {
  const state = downloads.stateFor(item.id)
  if (state === 'done') {
    return action('Remove download', 'check', async () => {
      if (window.confirm(`Remove the download for “${item.title}”?`)) {
        await downloads.removeTrack(item.id)
      }
    })
  }
  if (network.localFirst) {
    return action('Connect to download', 'download', () => undefined, { disabled: true })
  }
  if (state === 'downloading' || state === 'queued') {
    return action('Pause download', 'pause', () => downloads.pause(item.id))
  }
  if (state === 'paused') {
    return action('Resume download', 'play', () => downloads.resume(item.id))
  }
  if (state === 'failed') {
    return action('Retry download', 'alert', () => downloads.retry(item.id))
  }
  return action('Download', 'download', async () => {
    await downloads.addTrack(toTrack(item))
    toast.show(`Downloading ${item.title}`)
  })
}

function songEntries(subject: ContextSubject, anchor: HTMLElement): MenuEntry[] {
  const item = subject.item
  const track = toTrack(item)
  const liked = favorites.has(item.id)
  const artist = subject.artist ?? itemArtist(item)
  const album = albumLink(item)

  return grouped([
    action('Play', 'play', () => {
      if (subject.play) return subject.play()
      if (subject.context?.length) return player.playList(subject.context, subject.index ?? 0)
      return player.playItem(item)
    }),
    action('Play next', 'forward', () => playNext(item)),
    action('Add to queue', 'queueAdd', () => {
      player.enqueue(item)
      toast.show(`Added ${item.title} to queue`)
    }),
    playlistSubmenu(anchor, async () => [track]),
    action(liked ? 'Remove from Liked Songs' : 'Like', 'heart', async () => {
      await favorites.toggle(track)
    }),
    songDownload(item),
    artist || album.id || item.album || album.title ? separator() : null,
    artist
      ? action('Go to artist', 'user', () => openArtist(artist.id, artist.name))
      : null,
    album.id || item.album || album.title
      ? action('Go to album', 'disc', () => goToAlbum(item))
      : null,
    subject.onRemove ? separator() : null,
    subject.onRemove
      ? action(subject.removeLabel ?? 'Remove', 'close', subject.onRemove)
      : null
  ])
}

function releaseSnapshot(item: CatalogItem, id: string, artist?: { name: string; id?: string }): SavedAlbum {
  const year = /\b(19\d{2}|20\d{2})\b/.exec(item.subtitle ?? '')?.[0]
  return {
    id,
    title: item.title,
    artist: artist?.name,
    artistId: artist?.id,
    thumbnail: item.thumbnail,
    releaseType: item.releaseType,
    year,
    savedAt: Date.now()
  }
}

function downloadCollection(
  item: CatalogItem,
  key: string,
  kind: 'album' | 'playlist'
): MenuEntry {
  const collection = downloads.collections.find((entry) => entry.key === key)
  const ids = collection?.trackIds ?? []
  const done = ids.filter((id) => downloads.downloaded(id)).length
  const jobs = Object.values(downloads.jobs).filter((job) => job.sources.includes(key))
  const active = jobs.some((job) => job.state === 'queued' || job.state === 'downloading')
  const paused = jobs.some((job) => job.state === 'paused')

  if (ids.length > 0 && done === ids.length) {
    return action('Remove download', 'check', async () => {
      if (window.confirm(`Remove “${item.title}” from downloads?`)) {
        await downloads.removeCollection(key)
      }
    })
  }
  if (network.localFirst) {
    return action('Connect to download', 'download', () => undefined, { disabled: true })
  }
  if (active) return action('Pause download', 'pause', () => downloads.pauseCollection(key))
  if (paused) return action('Resume download', 'play', () => downloads.resumeCollection(key))

  return action('Download', 'download', async () => {
    const items = await loadCollection(item)
    if (!items?.length) {
      toast.show(`Could not load this ${kind}.`)
      return
    }
    const tracks = items.map(toTrack)
    await downloads.addCollection(
      {
        key,
        kind,
        title: item.title,
        thumbnail: item.thumbnail,
        trackIds: tracks.map((track) => track.id)
      },
      tracks
    )
    toast.show(`Downloading ${item.title}`)
  })
}

async function loadOrSay(item: CatalogItem): Promise<CatalogItem[] | null> {
  const items = await loadCollection(item)
  if (!items?.length) toast.show(`Could not load this ${item.kind}.`)
  return items?.length ? items : null
}

function collectionEntries(
  subject: ContextSubject,
  anchor: HTMLElement,
  kind: 'album' | 'playlist'
): MenuEntry[] {
  const item = subject.item
  const id = item.browseId ?? item.id
  if (!id) return []

  const key = `${kind}:${id}`
  const artist = subject.artist ?? itemArtist(item)
  const saved = kind === 'album' && savedAlbums.has(id)

  return grouped([
    action('Play', 'play', async () => {
      const items = await loadOrSay(item)
      if (items) await player.playList(items, 0)
    }),
    action('Add to queue', 'queueAdd', async () => {
      const items = await loadOrSay(item)
      if (!items) return
      player.enqueueAll(items)
      toast.show(`Added ${items.length} songs to queue`)
    }),
    playlistSubmenu(anchor, async () => {
      const items = await loadOrSay(item)
      return items?.map(toTrack) ?? null
    }),
    kind === 'album'
      ? action(saved ? 'Remove from Library' : 'Save to Library', saved ? 'check' : 'plus', async () => {
          await savedAlbums.toggle(releaseSnapshot(item, id, artist ?? undefined))
        })
      : null,
    downloadCollection(item, key, kind),
    artist ? separator() : null,
    artist
      ? action('Go to artist', 'user', () => openArtist(artist.id, artist.name))
      : null
  ])
}

/** Build the actions for a right-clicked row or card; empty means no menu. */
export function buildContextEntries(subject: ContextSubject, anchor: HTMLElement): MenuEntry[] {
  const item = subject.item
  if (!item.id) return []
  if (item.kind === 'song') return songEntries(subject, anchor)
  if (item.kind === 'album') return collectionEntries(subject, anchor, 'album')
  if (item.kind === 'playlist') return collectionEntries(subject, anchor, 'playlist')
  return []
}
