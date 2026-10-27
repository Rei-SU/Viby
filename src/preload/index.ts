import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type LyricsRequest,
  type NavCommand,
  type PlayerCommand,
  type ResolveRequest,
  type TaskbarState,
  type VibyApi
} from '@shared/ipc'
import type {
  DownloadCollectionInput,
  DownloadProgress,
  DownloadsSnapshot,
  HistoryEntry,
  ImportCreateInput,
  ImportProgress,
  ImportSource,
  NetworkState,
  OfflineMode,
  PlaybackSession,
  SearchFilterName,
  Settings,
  Track,
  UpdateState
} from '@shared/types'

/**
 * The only bridge between renderer and main. Nothing else is exposed: no `require`,
 * no Node globals, no filesystem.
 */
const api: VibyApi = {
  platform: process.platform,
  app: {
    onOpenSettings: (callback: () => void) => {
      const handler = (): void => callback()
      ipcRenderer.on(CH.appOpenSettings, handler)
      return () => ipcRenderer.removeListener(CH.appOpenSettings, handler)
    },
    onNavigate: (callback: (command: NavCommand) => void) => {
      const handler = (_event: unknown, command: NavCommand): void => callback(command)
      ipcRenderer.on(CH.appNavigate, handler)
      return () => ipcRenderer.removeListener(CH.appNavigate, handler)
    },
    copyText: (text: string) => ipcRenderer.invoke(CH.appCopyText, text)
  },
  settings: {
    get: () => ipcRenderer.invoke(CH.settingsGet),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke(CH.settingsSet, patch)
  },
  session: {
    get: () => ipcRenderer.invoke(CH.sessionGet),
    save: (session: PlaybackSession) => ipcRenderer.invoke(CH.sessionSet, session)
  },
  lyrics: {
    get: (req: LyricsRequest) => ipcRenderer.invoke(CH.lyricsGet, req)
  },
  player: {
    resolve: (req: ResolveRequest) => ipcRenderer.invoke(CH.playerResolve, req),
    prefetch: (input: string) => ipcRenderer.send(CH.playerPrefetch, input),
    cancel: () => ipcRenderer.send(CH.playerCancel),
    setPlaying: (playing: boolean) => ipcRenderer.send(CH.playerState, playing),
    setTaskbarControls: (state: TaskbarState) => ipcRenderer.send(CH.playerTaskbar, state),
    onCommand: (callback: (command: PlayerCommand) => void) => {
      const handler = (_event: unknown, command: PlayerCommand): void => callback(command)
      ipcRenderer.on(CH.playerCommand, handler)
      return () => ipcRenderer.removeListener(CH.playerCommand, handler)
    }
  },
  catalog: {
    search: (query: string, filter?: SearchFilterName) =>
      ipcRenderer.invoke(CH.catalogSearch, query, filter),
    browse: (browseId: string, params?: string) =>
      ipcRenderer.invoke(CH.catalogBrowse, browseId, params),
    home: () => ipcRenderer.invoke(CH.catalogHome),
    moods: () => ipcRenderer.invoke(CH.catalogMoods),
    radio: (videoId: string) => ipcRenderer.invoke(CH.catalogRadio, videoId),
    audioTrack: (videoId: string, title: string, artist: string) =>
      ipcRenderer.invoke(CH.catalogAudioTrack, videoId, title, artist),
    artistImage: (artistId: string | undefined, name: string) =>
      ipcRenderer.invoke(CH.catalogArtistImage, artistId, name)
  },
  history: {
    add: (entry: HistoryEntry) => ipcRenderer.invoke(CH.historyAdd, entry),
    list: (limit?: number) => ipcRenderer.invoke(CH.historyList, limit),
    summary: () => ipcRenderer.invoke(CH.historySummary)
  },
  favorites: {
    list: () => ipcRenderer.invoke(CH.favoritesList),
    toggle: (track: Track) => ipcRenderer.invoke(CH.favoritesToggle, track)
  },
  library: {
    playlists: () => ipcRenderer.invoke(CH.libraryPlaylists),
    createPlaylist: (name: string) => ipcRenderer.invoke(CH.libraryPlaylistCreate, name),
    renamePlaylist: (id: string, name: string) =>
      ipcRenderer.invoke(CH.libraryPlaylistRename, id, name),
    deletePlaylist: (id: string) => ipcRenderer.invoke(CH.libraryPlaylistDelete, id),
    addToPlaylist: (id: string, track: Track) =>
      ipcRenderer.invoke(CH.libraryPlaylistAdd, id, track),
    removeFromPlaylist: (id: string, trackId: string) =>
      ipcRenderer.invoke(CH.libraryPlaylistRemove, id, trackId)
  },
  cache: {
    stats: () => ipcRenderer.invoke(CH.cacheStats),
    clear: () => ipcRenderer.invoke(CH.cacheClear)
  },
  images: {
    cache: (urls: string[]) => ipcRenderer.invoke(CH.imagesCache, urls),
    dataUrl: (src: string) => ipcRenderer.invoke(CH.imagesDataUrl, src)
  },
  network: {
    get: () => ipcRenderer.invoke(CH.networkGet),
    setMode: (mode: OfflineMode) => ipcRenderer.invoke(CH.networkSetMode, mode),
    recheck: () => ipcRenderer.invoke(CH.networkRecheck),
    onChange: (callback: (state: NetworkState) => void) => {
      const handler = (_event: unknown, state: NetworkState): void => callback(state)
      ipcRenderer.on(CH.networkChanged, handler)
      return () => ipcRenderer.removeListener(CH.networkChanged, handler)
    }
  },
  updates: {
    get: () => ipcRenderer.invoke(CH.updatesGet),
    check: () => ipcRenderer.invoke(CH.updatesCheck),
    download: () => ipcRenderer.invoke(CH.updatesDownload),
    cancel: () => ipcRenderer.invoke(CH.updatesCancel),
    install: () => ipcRenderer.invoke(CH.updatesInstall),
    onChange: (callback: (state: UpdateState) => void) => {
      const handler = (_event: unknown, state: UpdateState): void => callback(state)
      ipcRenderer.on(CH.updatesChanged, handler)
      return () => ipcRenderer.removeListener(CH.updatesChanged, handler)
    }
  },
  downloads: {
    snapshot: () => ipcRenderer.invoke(CH.downloadsSnapshot),
    addTrack: (track: Track) => ipcRenderer.invoke(CH.downloadsAddTrack, track),
    addCollection: (input: DownloadCollectionInput, tracks: Track[]) =>
      ipcRenderer.invoke(CH.downloadsAddCollection, input, tracks),
    removeTrack: (trackId: string) => ipcRenderer.invoke(CH.downloadsRemoveTrack, trackId),
    removeCollection: (key: string) => ipcRenderer.invoke(CH.downloadsRemoveCollection, key),
    pruneCollection: (key: string, trackIds: string[]) =>
      ipcRenderer.invoke(CH.downloadsPruneCollection, key, trackIds),
    clear: () => ipcRenderer.invoke(CH.downloadsClear),
    retry: (trackId: string) => ipcRenderer.invoke(CH.downloadsRetry, trackId),
    cancel: (trackId: string) => ipcRenderer.invoke(CH.downloadsCancel, trackId),
    onChanged: (callback: (snapshot: DownloadsSnapshot) => void) => {
      const handler = (_event: unknown, snapshot: DownloadsSnapshot): void => callback(snapshot)
      ipcRenderer.on(CH.downloadsChanged, handler)
      return () => ipcRenderer.removeListener(CH.downloadsChanged, handler)
    },
    onProgress: (callback: (progress: DownloadProgress) => void) => {
      const handler = (_event: unknown, progress: DownloadProgress): void => callback(progress)
      ipcRenderer.on(CH.downloadsProgress, handler)
      return () => ipcRenderer.removeListener(CH.downloadsProgress, handler)
    }
  },
  ytDlp: {
    info: () => ipcRenderer.invoke(CH.ytdlpInfo),
    update: () => ipcRenderer.invoke(CH.ytdlpUpdate)
  },
  import: {
    resolve: (url: string) => ipcRenderer.invoke(CH.importResolve, url),
    match: (source: ImportSource) => ipcRenderer.invoke(CH.importMatch, source),
    cancel: () => ipcRenderer.invoke(CH.importCancel),
    create: (input: ImportCreateInput) => ipcRenderer.invoke(CH.importCreate, input),
    onProgress: (callback: (progress: ImportProgress) => void) => {
      const handler = (_event: unknown, progress: ImportProgress): void => callback(progress)
      ipcRenderer.on(CH.importProgress, handler)
      return () => ipcRenderer.removeListener(CH.importProgress, handler)
    }
  },
  ...(process.env.VIBY_DEBUG_PORT
    ? {
        debug: {
          forgetHistory: (titles: string[]) =>
            ipcRenderer.invoke(CH.historyForget, titles) as Promise<number>
        }
      }
    : {})
}

contextBridge.exposeInMainWorld('viby', api)
