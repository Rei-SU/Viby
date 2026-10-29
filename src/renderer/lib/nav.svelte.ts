import type { CatalogItem, Track } from '@shared/types'

export type View =
  | 'home'
  | 'search'
  | 'library'
  | 'import'
  | 'settings'

/** A collection page: liked songs, a user playlist, or a downloaded collection. */
export type CollectionRef =
  | { kind: 'liked' }
  | { kind: 'playlist'; id: string }
  /** `album:<id>`, `playlist:<id>` or `liked` — rendered from local downloads. */
  | { kind: 'download'; key: string }

/** A "Moods & moments" page: the title is the card's label, params select it. */
export type MoodRef = {
  title: string
  params: string
  thumbnail?: string
}

/**
 * A row the release page should reveal after it opens. The title is a fallback
 * for search results that point at the video while the release holds the audio.
 * The nonce makes a repeated click re-run the scroll and highlight.
 */
export type TrackFocus = {
  trackId: string
  title: string
  durationSec?: number
  nonce: number
}

type Snapshot = {
  view: View
  detail: CatalogItem | null
  track: Track | null
  collection: CollectionRef | null
  mood: MoodRef | null
}

/**
 * One place for "where am I", so any component — a list row, the player bar —
 * can navigate without threading callbacks through the whole tree.
 *
 * History works like a browser: Back moves through the pages you came from,
 * Forward replays the ones you backed out of, and a new navigation clears the
 * forward trail.
 */
class Navigator {
  view = $state<View>('home')
  detail = $state<CatalogItem | null>(null)
  /** The song page shown from the player bar title. */
  track = $state<Track | null>(null)
  /** The playlist / liked-songs page. */
  collection = $state<CollectionRef | null>(null)
  /** A YouTube Music mood or genre page. */
  mood = $state<MoodRef | null>(null)
  /** A song the release page should scroll to and highlight. */
  focus = $state<TrackFocus | null>(null)

  private backStack = $state<Snapshot[]>([])
  private forwardStack = $state<Snapshot[]>([])
  private focusNonce = 0
  /** Bumped on every real navigation; async resolvers drop stale clicks. */
  private rev = 0

  get canGoBack(): boolean {
    return this.backStack.length > 0
  }

  get canGoForward(): boolean {
    return this.forwardStack.length > 0
  }

  get revision(): number {
    return this.rev
  }

  go(view: View): void {
    // Clicking the tab you are already on should not create a history entry.
    if (this.view === view && !this.detail && !this.track && !this.collection && !this.mood) return
    this.record()
    this.view = view
    this.detail = null
    this.track = null
    this.collection = null
    this.mood = null
  }

  open(item: CatalogItem): void {
    if (!item.browseId && !item.id) return
    if (this.detail?.kind === item.kind && this.detail?.id === item.id) return
    this.record()
    this.detail = item
    this.track = null
    this.collection = null
    this.mood = null
  }

  /**
   * Open a release and reveal one of its songs. Clicking a title while already
   * on that release still scrolls, so the focus is set even without navigating.
   */
  openReleaseAt(
    item: CatalogItem,
    trackId: string,
    title: string,
    durationSec?: number
  ): void {
    this.open(item)
    this.focus = { trackId, title, durationSec, nonce: ++this.focusNonce }
  }

  /** Called by the page once it has scrolled; a stale page must not clear it. */
  clearFocus(nonce: number): void {
    if (this.focus?.nonce === nonce) this.focus = null
  }

  /** A mood page from the Home "Start something" cards. */
  openMood(ref: MoodRef): void {
    if (!ref.params || (this.mood?.params === ref.params && this.mood?.title === ref.title)) return
    this.record()
    this.mood = ref
    this.detail = null
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
    if (this.track?.id === track.id) return
    this.record()
    // Copy: the queue holds reactive proxies and the page should keep its own
    // snapshot if the queue moves on.
    this.track = { ...track }
    this.detail = null
    this.collection = null
    this.mood = null
  }

  openCollection(ref: CollectionRef): void {
    if (this.collection && this.collection.kind === ref.kind) {
      if (ref.kind === 'liked') return
      if (ref.kind === 'playlist' && this.collection.kind === 'playlist' && this.collection.id === ref.id)
        return
      if (ref.kind === 'download' && this.collection.kind === 'download' && this.collection.key === ref.key)
        return
    }
    this.record()
    this.collection = ref
    this.detail = null
    this.track = null
    this.mood = null
  }

  back(): void {
    const previous = this.backStack.pop()
    if (!previous) return
    this.pushForward(this.snapshot())
    this.restore(previous)
  }

  forward(): void {
    const next = this.forwardStack.pop()
    if (!next) return
    this.pushBack(this.snapshot())
    this.restore(next)
  }

  /** Drop the forward trail after the page it points at is deleted. */
  clearForward(): void {
    this.forwardStack = []
  }

  private record(): void {
    this.pushBack(this.snapshot())
    this.forwardStack = []
    this.focus = null
    this.rev++
  }

  private pushBack(snapshot: Snapshot): void {
    this.backStack.push(snapshot)
    if (this.backStack.length > 40) this.backStack.shift()
  }

  private pushForward(snapshot: Snapshot): void {
    this.forwardStack.push(snapshot)
    if (this.forwardStack.length > 40) this.forwardStack.shift()
  }

  private snapshot(): Snapshot {
    return {
      view: this.view,
      detail: this.detail,
      track: this.track,
      collection: this.collection,
      mood: this.mood
    }
  }

  private restore(snapshot: Snapshot): void {
    this.view = snapshot.view
    this.detail = snapshot.detail
    this.track = snapshot.track
    this.collection = snapshot.collection
    this.mood = snapshot.mood
    this.focus = null
    this.rev++
  }
}

export const nav = new Navigator()
