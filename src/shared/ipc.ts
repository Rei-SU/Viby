import type { ListeningSummary } from './listening'
import type {
  BrowseResult,
  CacheStats,
  CatalogItem,
  DownloadCollectionInput,
  DownloadProgress,
  DownloadsSnapshot,
  HistoryEntry,
  ImportCreateInput,
  ImportMatch,
  ImportProgress,
  ImportSource,
  Lyrics,
  MoodCategory,
  NetworkState,
  OfflineMode,
  PlaybackSession,
  Playlist,
  ResolveResult,
  Result,
  SearchFilterName,
  Settings,
  Shelf,
  Track,
  UpdateState,
  YtDlpInfo
} from './types'

/** One source of truth for IPC channel names. */
export const CH = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  appOpenSettings: 'app:open-settings',
  appCopyText: 'app:copy-text',
  appNavigate: 'app:navigate',

  playerResolve: 'player:resolve',
  playerPrefetch: 'player:prefetch',
  playerCancel: 'player:cancel',
  playerState: 'player:state',
  playerTaskbar: 'player:taskbar',
  playerCommand: 'player:command',

  sessionGet: 'session:get',
  sessionSet: 'session:set',

  lyricsGet: 'lyrics:get',

  historyAdd: 'history:add',
  historyList: 'history:list',
  historySummary: 'history:summary',
  historyForget: 'history:forget',

  favoritesList: 'favorites:list',
  favoritesToggle: 'favorites:toggle',

  libraryPlaylists: 'library:playlists',
  libraryPlaylistCreate: 'library:playlist-create',
  libraryPlaylistRename: 'library:playlist-rename',
  libraryPlaylistDelete: 'library:playlist-delete',
  libraryPlaylistAdd: 'library:playlist-add',
  libraryPlaylistRemove: 'library:playlist-remove',

  catalogSearch: 'catalog:search',
  catalogBrowse: 'catalog:browse',
  catalogHome: 'catalog:home',
  catalogMoods: 'catalog:moods',
  catalogRadio: 'catalog:radio',
  catalogAudioTrack: 'catalog:audio-track',
  catalogArtistImage: 'catalog:artist-image',

  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
  imagesCache: 'images:cache',
  imagesDataUrl: 'images:data-url',

  networkGet: 'network:get',
  networkSetMode: 'network:set-mode',
  networkRecheck: 'network:recheck',
  networkChanged: 'network:changed',

  updatesGet: 'updates:get',
  updatesCheck: 'updates:check',
  updatesDownload: 'updates:download',
  updatesCancel: 'updates:cancel',
  updatesInstall: 'updates:install',
  updatesChanged: 'updates:changed',

  downloadsSnapshot: 'downloads:snapshot',
  downloadsAddTrack: 'downloads:add-track',
  downloadsAddCollection: 'downloads:add-collection',
  downloadsRemoveTrack: 'downloads:remove-track',
  downloadsRemoveCollection: 'downloads:remove-collection',
  downloadsPruneCollection: 'downloads:prune-collection',
  downloadsClear: 'downloads:clear',
  downloadsRetry: 'downloads:retry',
  downloadsCancel: 'downloads:cancel',
  downloadsChanged: 'downloads:changed',
  downloadsProgress: 'downloads:progress',

  ytdlpInfo: 'ytdlp:info',
  ytdlpUpdate: 'ytdlp:update',

  importResolve: 'import:resolve',
  importMatch: 'import:match',
  importCancel: 'import:cancel',
  importCreate: 'import:create',
  importProgress: 'import:progress'
} as const

export type LyricsRequest = {
  trackId: string
  title: string
  artist: string
  durationSec: number
  album?: string
}

/**
 * What the Windows taskbar thumbnail toolbar needs to draw the right controls.
 * Sent on every player state change; main keeps only the latest one, so the
 * hover preview is always drawn from current state.
 */
export type TaskbarState = {
  hasTrack: boolean
  playing: boolean
  canPrevious: boolean
  canNext: boolean
}

/** A media command from the taskbar thumbnail toolbar. */
export type PlayerCommand = 'toggle' | 'previous' | 'next'

/**
 * A history step requested by the OS rather than by a click in the app.
 *
 * Only the paths the renderer cannot see arrive here: on Windows/Linux a mouse
 * side button reported as an `app-command`, and on macOS a swipe, which is what
 * vendor drivers turn those buttons into. Plain XBUTTON presses reach the
 * renderer as ordinary `mouseup` events and are handled there.
 */
export type NavCommand = 'back' | 'forward'

export type ResolveRequest = {
  /** A YouTube Music / YouTube URL, or a bare 11-character video id. */
  input: string
  /** Bypass the resolved-URL and metadata caches. */
  force?: boolean
  /** Delete the cached audio for this track (the file is known to be bad). */
  discardCache?: boolean
}

/** The entire surface the renderer is allowed to touch. */
export interface VibyApi {
  /** `darwin` / `win32`, used to lay out the window chrome. */
  platform: string
  app: {
    /** The tray or menu bar asked the window to open Settings. */
    onOpenSettings(callback: () => void): () => void
    /** A mouse side button or macOS swipe, relayed by the main process. */
    onNavigate(callback: (command: NavCommand) => void): () => void
    /** Copy diagnostic text (for example a playback error) to the OS clipboard. */
    copyText(text: string): Promise<boolean>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  session: {
    get(): Promise<PlaybackSession>
    save(session: PlaybackSession): Promise<void>
  }
  lyrics: {
    get(req: LyricsRequest): Promise<Result<Lyrics>>
  }
  player: {
    resolve(req: ResolveRequest): Promise<Result<ResolveResult>>
    /** Warm a stream URL in the background; resolves nothing in the renderer. */
    prefetch(input: string): void
    /** Abort an in-flight resolve so a slow track cannot hold the UI hostage. */
    cancel(): void
    /** Tells main whether audio is currently playing, for the power blocker. */
    setPlaying(playing: boolean): void
    /** Windows: mirror playback into the taskbar thumbnail toolbar. */
    setTaskbarControls(state: TaskbarState): void
    /** Windows: play/pause, previous and next from the taskbar thumbnail toolbar. */
    onCommand(callback: (command: PlayerCommand) => void): () => void
  }
  catalog: {
    search(query: string, filter?: SearchFilterName): Promise<Result<CatalogItem[]>>
    /**
     * Browse a page. `params` selects a Moods & Genres category, whose page is
     * only reachable with the params that produced its tile.
     */
    browse(browseId: string, params?: string): Promise<Result<BrowseResult>>
    home(): Promise<Result<Shelf[]>>
    /** The "Moods & moments" and genre tiles YouTube Music offers. */
    moods(): Promise<Result<MoodCategory[]>>
    /** Related tracks for autoplay, seeded by a video id. */
    radio(videoId: string): Promise<Result<CatalogItem[]>>
    /** The released audio track for a music video, when YouTube knows one. */
    audioTrack(videoId: string, title: string, artist: string): Promise<Result<CatalogItem | null>>
    /** Square artist portrait, resolved from a lightweight catalogue search. */
    artistImage(artistId: string | undefined, name: string): Promise<Result<string | null>>
  }
  history: {
    add(entry: HistoryEntry): Promise<void>
    list(limit?: number): Promise<HistoryEntry[]>
    /** Seven-day listening time and artist shares from local history only. */
    summary(): Promise<ListeningSummary>
  }
  favorites: {
    list(): Promise<Track[]>
    toggle(track: Track): Promise<{ favorited: boolean; favorites: Track[] }>
  }
  library: {
    playlists(): Promise<Playlist[]>
    createPlaylist(name: string): Promise<Playlist>
    renamePlaylist(id: string, name: string): Promise<Playlist | null>
    deletePlaylist(id: string): Promise<void>
    addToPlaylist(id: string, track: Track): Promise<Playlist | null>
    removeFromPlaylist(id: string, trackId: string): Promise<Playlist | null>
  }
  cache: {
    stats(): Promise<CacheStats>
    clear(): Promise<CacheStats>
  }
  images: {
    /** Cache remote artwork under userData and return URL → local media URL. */
    cache(urls: string[]): Promise<Record<string, string>>
    /**
     * Read a cached/downloaded image back as a data URL. Chromium refuses to
     * fetch a custom scheme, and the media session only accepts
     * http(s)/data/blob artwork.
     */
    dataUrl(src: string): Promise<{ src: string; type: string } | null>
  }
  network: {
    get(): Promise<NetworkState>
    /** Persist the manual switch and return the resulting state. */
    setMode(mode: OfflineMode): Promise<NetworkState>
    /** Re-probe now, e.g. when the renderer sees an online/offline event. */
    recheck(): Promise<NetworkState>
    onChange(callback: (state: NetworkState) => void): () => void
  }
  updates: {
    get(): Promise<UpdateState>
    /** Ask GitHub for the latest release. Never downloads on its own. */
    check(): Promise<UpdateState>
    /**
     * Windows: download the installer in the background (then `install`).
     * macOS: download the correct DMG and open it, since it cannot self-update.
     */
    download(): Promise<UpdateState>
    /** Abort an in-progress download; the update stays offered. */
    cancel(): Promise<UpdateState>
    /** Windows only: quit, install the downloaded update, relaunch. */
    install(): Promise<UpdateState>
    onChange(callback: (state: UpdateState) => void): () => void
  }
  downloads: {
    snapshot(): Promise<DownloadsSnapshot>
    addTrack(track: Track): Promise<DownloadsSnapshot>
    addCollection(input: DownloadCollectionInput, tracks: Track[]): Promise<DownloadsSnapshot>
    removeTrack(trackId: string): Promise<DownloadsSnapshot>
    removeCollection(key: string): Promise<DownloadsSnapshot>
    /** Drop songs from a downloaded collection without touching its other owners. */
    pruneCollection(key: string, trackIds: string[]): Promise<DownloadsSnapshot>
    clear(): Promise<DownloadsSnapshot>
    retry(trackId: string): Promise<DownloadsSnapshot>
    cancel(trackId: string): Promise<DownloadsSnapshot>
    onChanged(callback: (snapshot: DownloadsSnapshot) => void): () => void
    onProgress(callback: (progress: DownloadProgress) => void): () => void
  }
  ytDlp: {
    info(): Promise<Result<YtDlpInfo>>
    update(): Promise<Result<YtDlpInfo>>
  }
  import: {
    resolve(url: string): Promise<Result<ImportSource>>
    match(source: ImportSource): Promise<Result<ImportMatch[]>>
    /** Stop an in-flight match; partial results are discarded by the UI. */
    cancel(): Promise<void>
    create(input: ImportCreateInput): Promise<Result<Playlist>>
    /** Progress events for the currently matching import. */
    onProgress(callback: (progress: ImportProgress) => void): () => void
  }
  /**
   * Only present when VIBY_DEBUG_PORT is set. Used by the e2e harness to keep
   * synthetic titles ("Track A", "Seed") out of real listening history.
   */
  debug?: {
    forgetHistory(titles: string[]): Promise<number>
  }
}
