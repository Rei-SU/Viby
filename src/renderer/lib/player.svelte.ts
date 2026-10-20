import type {
  CatalogItem,
  PlaybackSession,
  Repeat,
  Settings,
  StreamInfo,
  Track
} from '@shared/types'
import { api } from './api'
import { cacheRadio, cachedRadio } from './catalog-cache.svelte'

/**
 * The player owns exactly one <audio> element for the whole app (PLAN §6: one
 * decode path, no extra CPU) and mirrors its state to the OS through
 * navigator.mediaSession, which is how media keys and Now Playing work on both
 * macOS and Windows without a line of native code.
 *
 * Queues are built from catalog metadata, never from resolve results. Opening a
 * 100-track album costs zero yt-dlp calls; the stream is resolved lazily when a
 * track actually starts.
 */
const audio = new Audio()
audio.preload = 'auto'

/** The resolver reports user-initiated aborts with this exact message. */
const CANCELLED = 'Cancelled.'

export function isPlayable(item: CatalogItem): boolean {
  return item.kind === 'song' && !!item.id
}

export function toTrack(item: CatalogItem): Track {
  const parts = item.parts ?? []
  const artistPart = parts.find((part) => part.artistId)
  const albumPart = parts.find((part) => part.albumId)

  return {
    id: item.id,
    title: item.title,
    artist:
      item.artists?.join(', ') || artistPart?.text.trim() || item.subtitle || 'Unknown artist',
    artistId: artistPart?.artistId,
    album: albumPart?.text.trim(),
    albumId: albumPart?.albumId,
    durationSec: item.durationSec ?? 0,
    thumbnail: item.thumbnail,
    views: item.views,
    videoType: item.videoType
  }
}

class Player {
  current = $state<Track | null>(null)
  stream = $state<StreamInfo | null>(null)
  queue = $state<Track[]>([])
  index = $state(-1)

  playing = $state(false)
  position = $state(0)
  duration = $state(0)
  volume = $state(1)
  muted = $state(false)
  shuffle = $state(false)
  repeat = $state<Repeat>('off')
  /** Continue with related tracks when the queue runs out. */
  autoplay = $state(true)

  busy = $state(false)
  /** A failed source is being re-resolved; the play button shows the same spinner. */
  reconnecting = $state(false)
  elapsed = $state(0)
  error = $state<string | null>(null)

  private wired = false
  private handlersSet = false
  private recovering = false
  private timer: ReturnType<typeof setInterval> | null = null
  private settingsTimer: ReturnType<typeof setTimeout> | null = null
  private prefetched = new Set<string>()
  private radioPreparing = false
  private recoverTrackId: string | null = null
  private recoverAttempts = 0
  /** Set on launch: where to resume once the restored track is actually loaded. */
  private pendingResume: { id: string; position: number } | null = null
  private lastSaveAt = 0
  /**
   * Video id currently loaded in the <audio> element. Kept separate from
   * `current` so a stale event can never act on a track the UI has moved past.
   */
  private loadedId: string | null = null
  /**
   * Every start bumps this. A resolve that finishes after the user moved on is
   * ignored, so a slow track can never hijack playback from a newer one — and a
   * deliberate cancel is not reported as an error.
   */
  private playToken = 0

  async init(): Promise<void> {
    const s = await api.settings.get()
    this.applySettings(s)

    await this.restoreSession()

    if (!this.wired) {
      this.wire()
      this.wired = true
      window.addEventListener('beforeunload', () => this.persistSession(true))
    }
    this.setMediaHandlers()
  }

  /** Adopt settings changed outside the player (the Settings page). */
  applySettings(s: Settings): void {
    this.volume = s.volume
    this.muted = s.muted
    this.shuffle = s.shuffle
    this.repeat = s.repeat
    this.autoplay = s.autoplay
    audio.volume = s.volume
    audio.muted = s.muted
  }

  /** Open on the last track, paused at the timestamp where it stopped. */
  private async restoreSession(): Promise<void> {
    try {
      const saved = await api.session.get()
      if (!saved?.track) return

      const queue = saved.queue?.length > 0 ? saved.queue : [saved.track]
      const index = Math.min(Math.max(0, saved.index), queue.length - 1)
      const track = queue[index] ?? saved.track

      this.queue = queue
      this.index = index
      this.current = track
      this.duration = track.durationSec ?? 0
      const position = Math.max(0, saved.position ?? 0)
      this.position = this.duration > 0 ? Math.min(position, this.duration) : position
      this.pendingResume = { id: track.id, position: this.position }
      this.syncMetadata()
    } catch {
      // No session, or unreadable: start fresh.
    }
  }

  private persistSession(immediate = false): void {
    const now = Date.now()
    if (!immediate && now - this.lastSaveAt < 3000) return
    this.lastSaveAt = now

    const snapshot: PlaybackSession = {
      track: this.current ? { ...this.current } : null,
      queue: this.queue.slice(0, 100).map((track) => ({ ...track })),
      index: this.index,
      position: this.position,
      updatedAt: now
    }
    void api.session.save(snapshot)
  }

  private wire(): void {
    audio.onplay = () => {
      this.playing = true
      // Sound is coming out: any error banner is stale by definition.
      this.error = null
      api.player.setPlaying(true)
      this.syncPlaybackState()
    }
    audio.onpause = () => {
      this.playing = false
      api.player.setPlaying(false)
      this.syncPlaybackState()
    }
    audio.ontimeupdate = () => {
      // `removeAttribute('src')` can emit one last timeupdate with the old
      // currentTime; without this guard the player showed a position while idle.
      if (!this.loadedId) return
      this.position = audio.currentTime
      this.syncPositionState()
      this.persistSession()
    }
    audio.onloadedmetadata = () => {
      this.duration = Number.isFinite(audio.duration)
        ? audio.duration
        : (this.current?.durationSec ?? 0)
    }
    audio.onended = () => {
      // Only advance if the element really finished the track the UI is showing.
      // A stale `ended` from a replaced source used to skip a track silently.
      if (!this.current || this.loadedId !== this.current.id) return
      this.recordHistory()
      this.persistSession(true)
      void this.advance(1)
    }
    audio.onerror = () => {
      // ABORTED means we replaced the source on purpose (a track change); it is
      // not a playback failure and must not trigger a recovery resolve.
      const code = audio.error?.code
      if (code === 1) return
      console.warn('[player] media error', code ?? '?', this.current?.id ?? '-')
      void this.recover()
    }
  }

  // ---- queue -------------------------------------------------------------

  /** Play a list of catalog items, starting at `startIndex`. */
  async playList(items: CatalogItem[], startIndex = 0): Promise<void> {
    const tracks = items.filter(isPlayable).map(toTrack)
    if (tracks.length === 0) return
    this.queue = tracks
    this.index = Math.max(0, Math.min(startIndex, tracks.length - 1))
    await this.start(true)
  }

  /** Play one item, replacing the queue. */
  async playItem(item: CatalogItem): Promise<void> {
    if (!isPlayable(item)) return
    await this.playList([item], 0)
  }

  /** Append without interrupting playback. */
  enqueue(item: CatalogItem): void {
    if (!isPlayable(item)) return
    this.queue = [...this.queue, toTrack(item)]
    if (this.index < 0) {
      this.index = 0
      void this.start(true)
    }
  }

  enqueueAll(items: CatalogItem[]): void {
    for (const item of items) this.enqueue(item)
  }

  async playAt(i: number): Promise<void> {
    if (i < 0 || i >= this.queue.length) return
    this.index = i
    await this.start(true)
  }

  /** Import path: a pasted link with no catalog metadata behind it. */
  async play(input: string): Promise<void> {
    const token = ++this.playToken
    this.busy = true
    this.error = null
    this.startTimer()
    try {
      const res = await api.player.resolve({ input })
      if (token !== this.playToken) return
      if (!res.ok) {
        this.error = res.error === CANCELLED ? null : res.error
        return
      }
      const track: Track = {
        id: res.data.track.id,
        title: res.data.track.title,
        artist: res.data.track.artist,
        durationSec: res.data.track.durationSec,
        thumbnail: res.data.track.thumbnail
      }
      this.queue = [...this.queue, track]
      this.index = this.queue.length - 1
      this.stream = res.data.stream
      this.current = track
      this.position = 0
      this.duration = track.durationSec
      audio.src = res.data.stream.url
      this.loadedId = track.id
      this.syncMetadata()
      await audio.play().catch((err: unknown) => {
        this.error = err instanceof Error ? err.message : 'Playback failed'
      })
    } catch (err) {
      if (token !== this.playToken) return
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      if (token === this.playToken) {
        this.busy = false
        this.stopTimer()
      }
    }
  }

  /** Skip forward, honouring shuffle and repeat. */
  next(): void {
    void this.advance(1)
  }

  /** Restart the track first, like every other player does. */
  previous(): void {
    if (this.position > 3) this.seek(0)
    else void this.advance(-1)
  }

  /** Warm a track's stream URL without playing it (hover prefetch). */
  prefetch(id: string): void {
    if (!id || this.current?.id === id || this.prefetched.has(id)) return
    this.prefetched.add(id)
    api.player.prefetch(id)
  }

  /** Warm the first few playable items of a list the user is looking at. */
  prefetchList(items: CatalogItem[], count = 3): void {
    for (const item of items.filter(isPlayable).slice(0, count)) this.prefetch(item.id)
  }

  toggle(): void {
    if (!this.current) return

    // Restored session: nothing is loaded yet, so start it at the saved position.
    if (!audio.src) {
      void this.start(true)
      return
    }

    if (audio.paused) {
      if (!this.reconnecting) void this.resume()
    } else {
      audio.pause()
      this.recordHistory()
    }
  }

  /**
   * Resume a paused track. A source can be dead even though the element still
   * holds it (an expired YouTube URL, a cache file replaced on disk); play()
   * rejects immediately in that case. Retry through recover(), which shows the
   * spinner — silently swallowing the rejection looked like Play did nothing.
   */
  private async resume(): Promise<void> {
    this.error = null
    // A fresh user intent deserves a fresh retry budget. Two automatic failures
    // must not leave a track unplayable until it is re-queued.
    this.recoverTrackId = this.current?.id ?? null
    this.recoverAttempts = 0

    try {
      await audio.play()
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      // Replacing the source or an autoplay block is not a stream failure.
      if (name === 'AbortError' || name === 'NotAllowedError') return
      await this.recover()
    }
  }

  seek(seconds: number): void {
    if (!Number.isFinite(seconds)) return

    // Restored but not loaded yet: remember the new starting point instead.
    if (!audio.src) {
      const position = Math.max(0, Math.min(seconds, this.duration || seconds))
      this.position = position
      if (this.current) this.pendingResume = { id: this.current.id, position }
      return
    }

    audio.currentTime = Math.max(0, Math.min(seconds, this.duration || seconds))
    this.position = audio.currentTime
  }

  /** Underlying <audio> state, for diagnostics and the drive test. */
  get diagnostics(): {
    readyState: number
    networkState: number
    errorCode: number | null
    currentTime: number
    seekable: Array<[number, number]>
  } {
    const ranges: Array<[number, number]> = []
    for (let i = 0; i < audio.seekable.length; i++) {
      ranges.push([audio.seekable.start(i), audio.seekable.end(i)])
    }
    return {
      readyState: audio.readyState,
      networkState: audio.networkState,
      errorCode: audio.error?.code ?? null,
      currentTime: audio.currentTime,
      seekable: ranges
    }
  }

  cancel(): void {
    if (!this.busy) return
    this.playToken += 1
    api.player.cancel()
    this.busy = false
    this.elapsed = 0
    this.stopTimer()
  }

  // ---- volume & modes ----------------------------------------------------

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    audio.volume = this.volume
    if (this.volume > 0 && audio.muted) {
      audio.muted = false
      this.muted = false
    }
    // Dragging the slider fires this dozens of times; write once when it settles.
    this.persistSettings({ volume: this.volume, muted: this.muted })
  }

  toggleMute(): void {
    audio.muted = !audio.muted
    this.muted = audio.muted
    void api.settings.set({ muted: this.muted })
  }

  toggleShuffle(): void {
    this.shuffle = !this.shuffle
    void api.settings.set({ shuffle: this.shuffle })
  }

  toggleAutoplay(): void {
    this.autoplay = !this.autoplay
    void api.settings.set({ autoplay: this.autoplay })
  }

  cycleRepeat(): void {
    const order: Repeat[] = ['off', 'all', 'one']
    this.repeat = order[(order.indexOf(this.repeat) + 1) % order.length]
    void api.settings.set({ repeat: this.repeat })
  }

  clearQueue(): void {
    this.playToken += 1
    api.player.cancel()
    audio.pause()
    audio.removeAttribute('src')
    this.queue = []
    this.index = -1
    this.current = null
    this.stream = null
    this.position = 0
    this.duration = 0
    this.busy = false
    this.reconnecting = false
    this.loadedId = null
    this.pendingResume = null
    this.stopTimer()
    api.player.setPlaying(false)
    this.persistSession(true)
  }

  removeAt(i: number): void {
    if (i < 0 || i >= this.queue.length) return
    const wasCurrent = i === this.index
    this.queue = this.queue.filter((_, idx) => idx !== i)
    if (wasCurrent) {
      this.index = Math.min(this.index, this.queue.length - 1)
      if (this.index >= 0) void this.start(true)
      else this.clearQueue()
    } else if (i < this.index) {
      this.index -= 1
    }
  }

  // ---- internals ---------------------------------------------------------

  private startTimer(): void {
    this.elapsed = 0
    const startedAt = Date.now()
    this.stopTimer()
    this.timer = setInterval(() => {
      this.elapsed = Math.round((Date.now() - startedAt) / 1000)
    }, 500)
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private persistSettings(patch: Partial<Settings>): void {
    if (this.settingsTimer) clearTimeout(this.settingsTimer)
    this.settingsTimer = setTimeout(() => {
      this.settingsTimer = null
      void api.settings.set(patch)
    }, 300)
  }

  /**
   * Warm the next track's stream URL while the current one plays. A resolve is
   * the only slow step in playback (the resolver caches URLs for two hours), so
   * doing it ahead of time is what makes "next" feel instant.
   */
  private prefetchNext(): void {
    // Repeat-one repeats this track; shuffle has no known next. Warming a guess
    // in either case just wastes a resolve.
    if (this.repeat === 'one' || this.shuffle || this.queue.length === 0) return

    const next = this.queue[this.index + 1]
    if (!next) {
      // Last track: autoplay will need a radio queue, so fetch it and warm its
      // first URL now instead of leaving two seconds of silence at the seam.
      if (this.autoplay) void this.warmRadio()
      return
    }

    if (this.prefetched.has(next.id)) return
    this.prefetched.add(next.id)
    void api.player.resolve({ input: next.id })
  }

  /** Fetch the radio queue ahead of time and warm its first track. */
  private async warmRadio(): Promise<void> {
    if (this.radioPreparing) return

    const seed = this.queue[this.queue.length - 1]?.id ?? this.current?.id
    if (!seed) return

    const cached = cachedRadio(seed)
    if (cached) {
      const first = cached.find(isPlayable)
      if (first) this.prefetch(first.id)
      return
    }

    this.radioPreparing = true
    try {
      const res = await api.catalog.radio(seed)
      if (!res.ok) return
      cacheRadio(seed, res.data)
      const first = res.data.find(isPlayable)
      if (first) this.prefetch(first.id)
    } catch {
      // Best-effort: autoplay retries when the queue actually runs out.
    } finally {
      this.radioPreparing = false
    }
  }

  private async start(autoplay: boolean): Promise<void> {
    const track = this.queue[this.index]
    if (!track) return

    const token = ++this.playToken

    // A fresh attempt at a track gets a fresh retry budget.
    if (this.recoverTrackId !== track.id) {
      this.recoverTrackId = track.id
      this.recoverAttempts = 0
    }

    if (this.current?.id === track.id && audio.src) {
      // Already loaded: nothing to resolve, and anything older is now irrelevant.
      this.busy = false
      this.stopTimer()
      if (autoplay) await audio.play().catch(() => undefined)
      return
    }

    // Silence the previous track before resolving the next one. Leaving it
    // audible under a new title is confusing, and it also hides how long the
    // resolve actually takes.
    if (!audio.paused) audio.pause()

    // Show the track immediately from catalog metadata; audio follows.
    this.current = track
    this.stream = null
    this.error = null
    this.position = 0
    this.duration = track.durationSec
    this.busy = true
    this.startTimer()

    try {
      // "Prioritise audio": a music video's soundtrack is not the released
      // track. When YouTube knows the official audio version, play that instead
      // and update the queue entry so the UI stays truthful.
      if (track.videoType && track.videoType !== 'audio') {
        const alt = await api.catalog.audioTrack(track.id, track.title, track.artist)
        if (token !== this.playToken) return
        if (alt.ok && alt.data) {
          const better = alt.data
          // Keep the id we were launched from: the row that started this stays
          // highlighted even though playback moved to the official audio.
          track.sourceId = track.id
          track.id = better.id
          track.title = better.title
          track.artist = better.artists?.join(', ') || better.subtitle || track.artist
          track.artistId = better.parts?.find((part) => part.artistId)?.artistId ?? track.artistId
          track.durationSec = better.durationSec || track.durationSec
          track.thumbnail = better.thumbnail ?? track.thumbnail
          track.videoType = 'audio'
          this.duration = track.durationSec
          this.syncMetadata()
        }
      }

      const res = await api.player.resolve({ input: track.id })
      if (token !== this.playToken) return
      if (!res.ok) {
        // A cancel is the user's decision, not a playback failure.
        if (res.error !== CANCELLED) this.error = res.error
        return
      }
      this.stream = res.data.stream
      if (!track.durationSec && res.data.track.durationSec) {
        track.durationSec = res.data.track.durationSec
        this.duration = res.data.track.durationSec
      }
      // Catalog art can be missing (e.g. a track replayed from old history);
      // the resolver always knows the thumbnail, so fill it in for the UI.
      if (!track.thumbnail && res.data.track.thumbnail) {
        track.thumbnail = res.data.track.thumbnail
      }
      audio.src = res.data.stream.url
      this.loadedId = track.id

      // Resume where playback stopped last time (only for the restored track).
      const resumeAt = this.pendingResume?.id === track.id ? this.pendingResume.position : null
      this.pendingResume = null
      if (resumeAt && resumeAt > 1) {
        try {
          audio.currentTime = resumeAt
          this.position = resumeAt
        } catch {
          // Chromium applies the seek once metadata arrives.
        }
      }

      this.syncMetadata()
      if (autoplay) {
        try {
          await audio.play()
        } catch (err) {
          // Media failures are handled by recover() (a fresh URL or a remote
          // fallback). Showing the raw message here produced "failed to load
          // because no supported source was found" even when a retry worked.
          console.warn('[player] play rejected', (err as Error)?.message ?? err)
          void this.recover()
        }
      }
      this.prefetchNext()
      this.persistSession(true)
    } catch (err) {
      if (token !== this.playToken) return
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      if (token === this.playToken) {
        this.busy = false
        this.stopTimer()
      }
    }
  }

  /**
   * A stream can fail to load even though the track exists: a cached file may be
   * unusable, a persisted URL may have expired, or the CDN may refuse a request.
   * Re-resolve from scratch (which also bypasses the cache) and retry once or
   * twice before admitting defeat.
   */
  private async recover(): Promise<void> {
    const track = this.current
    if (this.recovering || !track) return

    if (this.recoverTrackId !== track.id) {
      this.recoverTrackId = track.id
      this.recoverAttempts = 0
    }
    if (this.recoverAttempts >= 2) {
      this.error = 'This track could not be played.'
      return
    }
    this.recoverAttempts += 1

    const token = this.playToken
    this.recovering = true
    this.reconnecting = true
    try {
      const resumeAt = this.position
      const res = await api.player.resolve({
        input: track.id,
        force: true,
        // A cached copy that failed to decode must not be handed back.
        discardCache: this.stream?.kind === 'file'
      })
      if (token !== this.playToken || this.current?.id !== track.id) return
      if (!res.ok) {
        if (res.error !== CANCELLED) this.error = res.error
        return
      }

      this.stream = res.data.stream
      audio.src = res.data.stream.url
      this.loadedId = track.id
      if (resumeAt > 1) audio.currentTime = resumeAt
      await audio.play().catch(() => undefined)
    } finally {
      this.recovering = false
      this.reconnecting = false
    }
  }

  private async advance(direction: 1 | -1): Promise<void> {
    if (this.queue.length === 0) return

    if (this.repeat === 'one') {
      audio.currentTime = 0
      await audio.play().catch(() => undefined)
      return
    }

    let next: number
    if (this.shuffle && this.queue.length > 1) {
      do {
        next = Math.floor(Math.random() * this.queue.length)
      } while (next === this.index)
    } else {
      next = this.index + direction
    }

    if (next < 0 || next >= this.queue.length) {
      if (this.repeat === 'all') {
        next = direction === 1 ? 0 : this.queue.length - 1
      } else if (direction === 1 && this.autoplay) {
        // Queue exhausted: continue with YouTube Music's radio for the last
        // track instead of stopping — or worse, with an unrelated list item.
        await this.extendWithRadio()
        if (this.index + 1 < this.queue.length) {
          next = this.index + 1
        } else {
          audio.pause()
          return
        }
      } else {
        audio.pause()
        return
      }
    }

    this.index = next
    await this.start(true)
  }

  /**
   * Append related tracks. Seeded from the last queued track, so autoplay keeps
   * drifting through the same neighbourhood instead of replaying the queue.
   */
  private async extendWithRadio(): Promise<void> {
    const seed = this.queue[this.queue.length - 1]?.id ?? this.current?.id
    if (!seed) return

    try {
      let items = cachedRadio(seed)
      if (!items) {
        const res = await api.catalog.radio(seed)
        if (!res.ok) return
        items = res.data
        cacheRadio(seed, items)
      }

      const known = new Set(this.queue.map((track) => track.id))
      const fresh = items.filter((item) => isPlayable(item) && !known.has(item.id)).slice(0, 25)
      if (fresh.length === 0) return

      this.queue = [...this.queue, ...fresh.map(toTrack)]
    } catch {
      // Autoplay is a convenience; never break playback over it.
    }
  }

  private recordHistory(): void {
    const track = this.current
    if (!track) return
    const completion = this.duration > 0 ? Math.min(1, this.position / this.duration) : 0
    void api.history.add({
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      playedAt: Date.now(),
      completion,
      thumbnail: track.thumbnail
    })
  }

  // ---- OS integration ----------------------------------------------------

  private setMediaHandlers(): void {
    if (!('mediaSession' in navigator) || this.handlersSet) return
    const ms = navigator.mediaSession
    const bind = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        // Unsupported action on this platform; skip it.
      }
    }
    bind('play', () => this.toggle())
    bind('pause', () => this.toggle())
    bind('nexttrack', () => void this.advance(1))
    bind('previoustrack', () => {
      if (audio.currentTime > 3) this.seek(0)
      else void this.advance(-1)
    })
    bind('seekto', (d) => {
      if (typeof d.seekTime === 'number') this.seek(d.seekTime)
    })
    bind('seekbackward', (d) => this.seek(this.position - (d.seekOffset ?? 10)))
    bind('seekforward', (d) => this.seek(this.position + (d.seekOffset ?? 10)))
    this.handlersSet = true
  }

  private syncMetadata(): void {
    if (!('mediaSession' in navigator)) return
    const track = this.current
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: 'Viby',
      artwork: track.thumbnail
        ? [{ src: track.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
        : []
    })
  }

  private syncPlaybackState(): void {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused'
  }

  private syncPositionState(): void {
    if (!('mediaSession' in navigator) || !this.duration) return
    try {
      navigator.mediaSession.setPositionState({
        duration: this.duration,
        playbackRate: audio.playbackRate,
        position: Math.min(this.position, this.duration)
      })
    } catch {
      // Some platforms reject position updates mid-seek; harmless.
    }
  }
}

export const player = new Player()

// Vite hot-reloads this module on every edit. Without disposing the old <audio>
// element it keeps playing, orphaned from the UI that replaced it — which looks
// exactly like "nothing is playing" while music plays on its own.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  })
}
