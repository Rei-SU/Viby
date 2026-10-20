import type { CatalogItem, Track } from '@shared/types'

export type View = 'home' | 'charts' | 'search' | 'library' | 'queue' | 'import' | 'settings'

/** A saved collection page: liked songs, or one user playlist. */
export type CollectionRef = { kind: 'liked' } | { kind: 'playlist'; id: string }

type Snapshot = {
  view: View
  detail: CatalogItem | null
  track: Track | null
  collection: CollectionRef | null
}

/**
 * One place for "where am I", so any component — a list row, the player bar —
 * can navigate without threading callbacks through the whole tree.
 *
 * Opening a page pushes onto a small stack so Back returns to where you actually
 * came from (song → artist → back → song → back → search results).
 */
class Navigator {
  view = $state<View>('home')
  detail = $state<CatalogItem | null>(null)
  /** The song page shown from the player bar title. */
  track = $state<Track | null>(null)
  /** The playlist / liked-songs page. */
  collection = $state<CollectionRef | null>(null)

  private stack: Snapshot[] = []

  go(view: View): void {
    // A sidebar tab is a new context, not a step in the current one.
    this.stack = []
    this.detail = null
    this.track = null
    this.collection = null
    this.view = view
  }

  open(item: CatalogItem): void {
    if (!item.browseId && !item.id) return
    this.push()
    this.detail = item
    this.track = null
    this.collection = null
  }

  openArtist(id: string, name: string, thumbnail?: string): void {
    if (!id) return
    this.open({
      id,
      browseId: id,
      kind: 'artist',
      title: name,
      subtitle: 'Artist',
      thumbnail
    })
  }

  /** The song page, reachable from the player bar title. */
  openTrack(track: Track): void {
    this.push()
    // Copy: the queue holds reactive proxies and the page should keep its own
    // snapshot if the queue moves on.
    this.track = { ...track }
    this.detail = null
    this.collection = null
  }

  openCollection(ref: CollectionRef): void {
    this.push()
    this.collection = ref
    this.detail = null
    this.track = null
  }

  back(): void {
    const previous = this.stack.pop()
    if (!previous) {
      this.detail = null
      this.track = null
      this.collection = null
      return
    }
    this.view = previous.view
    this.detail = previous.detail
    this.track = previous.track
    this.collection = previous.collection
  }

  private push(): void {
    this.stack.push({
      view: this.view,
      detail: this.detail,
      track: this.track,
      collection: this.collection
    })
    if (this.stack.length > 40) this.stack.shift()
  }
}

export const nav = new Navigator()
