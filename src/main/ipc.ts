import { createReadStream, rmSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { app, BrowserWindow, clipboard, ipcMain, powerSaveBlocker, protocol } from 'electron'
import type {
  BrowseResult,
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
  SavedAlbum,
  SearchFilterName,
  Settings,
  Shelf,
  StreamInfo,
  Track,
  YtDlpInfo
} from '@shared/types'
import {
  CH,
  type LyricsRequest,
  type ResolveRequest,
  type TaskbarState
} from '@shared/ipc'
import { summarizeHistory } from '@shared/listening'
import { setTaskbarState } from './taskbar'
import { qualityCapKbps, setSettings, settings } from './settings'
import { session } from './session'
import { cachedLyrics, getLyrics } from './lyrics'
import { lib } from './library'
import { AudioCache } from './cache/audio'
import { ImageCache } from './cache/images'
import { shouldCache } from './cache/policy'
import { Resolver, NoDirectUrlError } from './ytdlp/resolver'
import { ensureRunner, runnerInfo, updateRunner } from './ytdlp/binary'
import { JsonStore, userDataFile } from './json-store'
import { MEDIA_SCHEME, mediaUrlFor, mimeForPath, pathFromMediaUrl } from './media'
import * as innertube from './innertube/client'
import { resolveImport, matchImport } from './import'
import { networkMonitor } from './network'
import { DownloadsStore } from './downloads/store'
import { DownloadManager } from './downloads/manager'
import { Updater } from './updater'
import { createNativeUpdater } from './updater-native'
import { fetchLatestRelease } from './release-feed'
import { downloadMacInstaller } from './updater-manual'
import { applyBackgroundPlayback } from './background'
import { applyLaunchAtLogin } from './startup'

const resolver = new Resolver()
const inflightDownloads = new Set<string>()
const backgroundDownloadControllers = new Set<AbortController>()
let blockerId: number | null = null
let downloadBlockerId: number | null = null
/** The track the <audio> element is currently on, for download-safety checks. */
let playingTrackId: string | null = null
let lastResolvedId: string | null = null
let activeResolve: AbortController | null = null
/** All in-flight hover prefetches share one controller so a real click can cancel them. */
let prefetchAbort: AbortController | null = null

let downloads: DownloadsStore | null = null
let downloadsManager: DownloadManager | null = null

function downloadStore(): DownloadsStore {
  if (!downloads) downloads = new DownloadsStore(join(app.getPath('userData'), 'downloads'))
  return downloads
}

export function audioCache(): AudioCache {
  return new AudioCache(join(app.getPath('userData'), 'cache', 'audio'), () => settings().get().cacheCapBytes)
}

let cache: AudioCache | null = null
function cacheInstance(): AudioCache {
  if (!cache) cache = audioCache()
  return cache
}

let images: ImageCache | null = null
function imageCache(): ImageCache {
  if (!images) images = new ImageCache(join(app.getPath('userData'), 'cache', 'art'))
  return images
}

/** Metadata for anything we have played, so cached tracks work offline. */
let tracks: JsonStore<Record<string, Track>> | null = null
function trackStore(): JsonStore<Record<string, Track>> {
  if (!tracks) tracks = new JsonStore<Record<string, Track>>(userDataFile('tracks.json'), {})
  return tracks
}

export function registerIpc(): void {
  const ok = <T>(data: T): Result<T> => ({ ok: true, data })
  const fail = (err: unknown): Result<never> => ({
    ok: false,
    error: err instanceof Error ? err.message : String(err)
  })
  const offline = (): Result<never> | null =>
    networkMonitor.isOffline()
      ? fail(new Error("You're offline. Connect to the internet to browse."))
      : null

  let importJob: { cancelled: boolean } | null = null
let importResolveController: AbortController | null = null

  // Restore stream URLs resolved in the last two hours, so a restart does not
  // make you wait all over again for the tracks you were just playing.
  resolver.attachUrlCache(userDataFile('stream-urls.json'))

  // Pay the runner startup cost now, while the user is still browsing, instead
  // of on their first click.
  void ensureRunner().catch(() => undefined)

  cacheInstance()
  cacheInstance().evict()

  // ---- offline + downloads (PLAN §17) ------------------------------------
  const broadcast = <T>(channel: string, payload: T): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  const downloadsStore = downloadStore()
  const manager = new DownloadManager(downloadsStore, {
    // Downloads need the upstream host, not just a local link. Treat
    // `unreachable` (captive portal/DNS failure) as unavailable so we do not
    // spend retries and power on jobs that cannot finish.
    isOffline: () => networkMonitor.isLocalFirst(),
    isPlaying: (trackId) => playingTrackId === trackId,
    onProgress: (progress: DownloadProgress) => broadcast(CH.downloadsProgress, progress),
    onChanged: () => {
      void manager.snapshot().then((snapshot) => broadcast(CH.downloadsChanged, snapshot))
    },
    onBusy: (busy) => {
      // Downloads deserve the same app-suspension protection playback gets.
      if (busy && downloadBlockerId === null) {
        downloadBlockerId = powerSaveBlocker.start('prevent-app-suspension')
      } else if (!busy && downloadBlockerId !== null) {
        powerSaveBlocker.stop(downloadBlockerId)
        downloadBlockerId = null
      }
    },
    onCompleted: (trackId) => {
      // The explicit download supersedes the invisible cache copy — unless that
      // copy is the file currently playing, which must survive until eviction.
      if (playingTrackId !== trackId) cacheInstance().remove(trackId)
      const entry = downloadsStore.entry(trackId)
      if (entry) remember(entry.track)
    },
    // Used once per downloaded album to repair credits saved before the album
    // header's artist was parsed.
    catalogAlbum: async (browseId) => innertube.browse(browseId)
  })
  downloadsManager = manager

  networkMonitor.onChange((state: NetworkState) => {
    broadcast(CH.networkChanged, state)
    manager.onNetworkChange(!networkMonitor.isLocalFirst())
  })
  networkMonitor.start()
  manager.start()

  // ---- updates (PLAN §2.1, P5) -------------------------------------------
  // Windows installs in place through electron-updater (NSIS, per-user).
  // macOS cannot: its ad-hoc signature cannot satisfy Squirrel.Mac, so the DMG
  // is downloaded and opened for the user instead. Unpackaged builds have
  // neither adapter and answer checks with a clear message.
  const updater = new Updater({
    currentVersion: app.getVersion(),
    offline: () => networkMonitor.isOffline(),
    latestRelease: () => fetchLatestRelease(process.arch),
    native: app.isPackaged && process.platform === 'win32' ? createNativeUpdater() : undefined,
    downloadManual:
      app.isPackaged && process.platform === 'darwin' ? downloadMacInstaller : undefined,
    quit: () => app.quit(),
    skippedVersion: () => settings().get().skippedUpdateVersion,
    onState: (state) => broadcast(CH.updatesChanged, state)
  })

  ipcMain.handle(CH.updatesGet, () => updater.get())
  ipcMain.handle(CH.updatesCheck, () => updater.check())
  ipcMain.handle(CH.updatesDownload, () => updater.download())
  ipcMain.handle(CH.updatesCancel, () => updater.cancel())
  ipcMain.handle(CH.updatesInstall, () => updater.install())

  // One quiet check shortly after launch, then every six hours. Auto-checks
  // skip offline launches and never download anything: only the check runs.
  // Failures are only surfaced for a check the user asked for.
  if (app.isPackaged) {
    const autoCheck = (): void => {
      if (!settings().get().autoUpdateCheck) return
      if (networkMonitor.isOffline()) return
      void updater.check({ quiet: true })
    }
    setTimeout(autoCheck, 8_000).unref()
    setInterval(autoCheck, 6 * 60 * 60_000).unref()
  }

  const stopPlaybackBlocker = (): void => {
    if (blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  }

  app.on('before-quit', () => {
    manager.shutdown()
    networkMonitor.stop()
    stopPlaybackBlocker()
    for (const controller of backgroundDownloadControllers) controller.abort()
    backgroundDownloadControllers.clear()
    if (downloadBlockerId !== null) {
      powerSaveBlocker.stop(downloadBlockerId)
      downloadBlockerId = null
    }
  })

  // A renderer crash or reload never sends player:state=false. Release the
  // display-sleep blocker rather than leaving the machine awake all session.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', stopPlaybackBlocker)
    contents.on('destroyed', stopPlaybackBlocker)
  })

  ipcMain.handle(CH.settingsGet, (): Settings => settings().get())

  ipcMain.handle(CH.appCopyText, (_e, text: unknown): boolean => {
    if (typeof text !== 'string' || text.length === 0 || text.length > 20_000) return false
    clipboard.writeText(text)
    return true
  })

  ipcMain.handle(CH.settingsSet, (_e, patch: Partial<Settings>): Settings => {
    const previous = settings().get().audioQuality
    const next = setSettings(patch)

    // A smaller cap must take effect immediately, not on next launch.
    cacheInstance().evict(playingTrackId ?? undefined)

    // The offline switch may have been changed through the generic settings API.
    if (patch.offlineMode !== undefined) networkMonitor.applySettings()

    // Closing must only hide the window while a tray icon exists to bring it back.
    if (patch.backgroundPlayback !== undefined) {
      applyBackgroundPlayback(next.backgroundPlayback)
    }

    // The OS login item must follow the toggle (and the minimized argument).
    if (patch.launchAtLogin !== undefined || patch.launchMinimized !== undefined) {
      applyLaunchAtLogin(next)
    }

    // Stream URLs were resolved for the old quality ceiling; drop them so the
    // next play honours the new setting instead of reusing a stale bitrate.
    if (next.audioQuality !== previous) resolver.clearUrlCache()

    return next
  })

  ipcMain.handle(CH.networkGet, (): NetworkState => networkMonitor.get())

  ipcMain.handle(CH.networkSetMode, (_e, mode: OfflineMode): NetworkState =>
    networkMonitor.setMode(mode === 'offline' ? 'offline' : 'auto')
  )

  ipcMain.handle(CH.networkRecheck, async (): Promise<NetworkState> => {
    // The renderer's online/offline event is fresher than the poll timer, so
    // bypass the two-miss debounce and probe now.
    await networkMonitor.refresh(true)
    return networkMonitor.get()
  })

  const snapshot = (): Promise<DownloadsSnapshot> => manager.snapshot()

  ipcMain.handle(CH.downloadsSnapshot, () => snapshot())

  ipcMain.handle(CH.downloadsAddTrack, (_e, track: Track): Promise<DownloadsSnapshot> => {
    manager.addTrack(track, settings().get().audioQuality)
    return snapshot()
  })

  ipcMain.handle(
    CH.downloadsAddCollection,
    (_e, input: DownloadCollectionInput, tracks: Track[]): Promise<DownloadsSnapshot> => {
      manager.addCollection(input, Array.isArray(tracks) ? tracks : [], settings().get().audioQuality)
      return snapshot()
    }
  )

  ipcMain.handle(CH.downloadsRemoveTrack, (_e, trackId: string): Promise<DownloadsSnapshot> => {
    manager.removeTrack(trackId)
    return snapshot()
  })

  ipcMain.handle(
    CH.downloadsRemoveCollection,
    (_e, key: string): Promise<DownloadsSnapshot> => {
      manager.removeCollection(key)
      return snapshot()
    }
  )

  ipcMain.handle(
    CH.downloadsPruneCollection,
    (_e, key: string, trackIds: string[]): Promise<DownloadsSnapshot> => {
      manager.pruneCollection(key, Array.isArray(trackIds) ? trackIds : [])
      return snapshot()
    }
  )

  ipcMain.handle(CH.downloadsClear, (): Promise<DownloadsSnapshot> => {
    manager.clear()
    return snapshot()
  })

  ipcMain.handle(CH.downloadsRetry, (_e, trackId: string): Promise<DownloadsSnapshot> => {
    manager.retry(trackId)
    return snapshot()
  })

  ipcMain.handle(CH.downloadsCancel, (_e, trackId: string): Promise<DownloadsSnapshot> => {
    manager.cancel(trackId)
    return snapshot()
  })

  ipcMain.handle(CH.lyricsGet, async (_e, req: LyricsRequest): Promise<Result<Lyrics>> => {
    try {
      const store = downloadStore()

      // A downloaded song keeps its own copy, so lyrics survive both the shared
      // cache's 300-entry cap and a lost connection.
      const stored = store.lyrics(req.trackId)
      if (stored) return ok(stored)

      const cached = cachedLyrics(req.trackId)
      if (cached) return ok(cached)

      if (networkMonitor.isOffline()) {
        // The track is downloaded, so "no lyrics stored" is a real answer rather
        // than a connection error.
        if (store.entry(req.trackId)) return ok({ kind: 'none' })
        throw new Error("You're offline.")
      }

      const lyrics = await getLyrics(req)
      // Backfill downloads made before lyrics were stored with them: the next
      // online lookup pins the result for offline use.
      if (lyrics.kind !== 'none') store.putLyrics(req.trackId, lyrics)
      return ok(lyrics)
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(CH.sessionGet, (): PlaybackSession => session().get())

  ipcMain.handle(CH.sessionSet, (_e, value: PlaybackSession): void => {
    session().set(value)
  })

  ipcMain.handle(CH.playerResolve, async (_e, req: ResolveRequest): Promise<Result<ResolveResult>> => {
    // A real click outranks background warm-ups: cancel them so the resolve is
    // not queued behind work the user did not ask for.
    prefetchAbort?.abort()
    prefetchAbort = null

    // A new request supersedes any in-flight one; there is only one player.
    activeResolve?.abort()
    const controller = new AbortController()
    activeResolve = controller
    try {
      const result = await resolveForPlayback(req, controller.signal)
      lastResolvedId = result.track.id
      return ok(result)
    } catch (err) {
      return fail(err)
    } finally {
      if (activeResolve === controller) activeResolve = null
    }
  })

  ipcMain.on(CH.playerCancel, () => {
    activeResolve?.abort()
    activeResolve = null
  })

  /**
   * Hover prefetch: warm a track's stream URL while the pointer is on it, so the
   * click itself has nothing left to wait for. Best-effort and bounded — never
   * competes with real playback, and at most two warm-ups at a time.
   */
  const prefetching = new Set<string>()
  ipcMain.on(CH.playerPrefetch, (_e, input: string) => {
    const value = input?.trim()
    if (!value || activeResolve || networkMonitor.isOffline()) return
    if (prefetching.has(value) || prefetching.size >= 2) return
    const directId = Resolver.extractId(value)
    if (directId && downloadStore().has(directId)) return
    if (resolver.hasCached(value, qualityCapKbps())) return

    if (!prefetchAbort) prefetchAbort = new AbortController()
    const controller = prefetchAbort

    prefetching.add(value)
    void resolver
      .resolve(value, { signal: controller.signal, maxKbps: qualityCapKbps() })
      .catch(() => undefined)
      .finally(() => prefetching.delete(value))
  })

  // ---- catalog (PLAN §5.2, §5.3) ------------------------------------------
  // Search and browse answer in well under a second, so the UI never waits on
  // yt-dlp just to show music.

  ipcMain.handle(
    CH.catalogSearch,
    async (_e, query: string, filter?: SearchFilterName): Promise<Result<CatalogItem[]>> => {
      try {
        if (!query?.trim()) return ok([])
        const blocked = offline()
        if (blocked) return blocked
        return ok(await innertube.search(query.trim(), filter ?? 'all'))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    CH.catalogBrowse,
    async (_e, browseId: string, params?: unknown): Promise<Result<BrowseResult>> => {
      try {
        const blocked = offline()
        if (blocked) return blocked
        const category = typeof params === 'string' && params.length < 1024 ? params : undefined
        return ok(await innertube.browse(browseId, category))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(CH.catalogHome, async (): Promise<Result<Shelf[]>> => {
    try {
      const blocked = offline()
      if (blocked) return blocked
      return ok(await innertube.home())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(CH.catalogMoods, async (): Promise<Result<MoodCategory[]>> => {
    try {
      const blocked = offline()
      if (blocked) return blocked
      return ok(await innertube.moodCategories())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(CH.catalogRadio, async (_e, videoId: string): Promise<Result<CatalogItem[]>> => {
    try {
      const blocked = offline()
      if (blocked) return blocked
      return ok(await innertube.radio(videoId))
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(
    CH.catalogAudioTrack,
    async (_e, videoId: string, title: string, artist: string): Promise<Result<CatalogItem | null>> => {
      try {
        const blocked = offline()
        if (blocked) return blocked
        return ok(await innertube.audioTrackFor(videoId, title, artist))
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(
    CH.catalogArtistImage,
    async (_e, artistId: unknown, name: unknown): Promise<Result<string | null>> => {
      if (typeof name !== 'string' || !name.trim()) return ok(null)
      if (offline()) return ok(null)
      try {
        return ok(
          await innertube.artistImage(
            typeof artistId === 'string' ? artistId : undefined,
            name.slice(0, 200)
          )
        )
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.on(CH.playerState, (_e, playing: boolean) => {
    playingTrackId = playing ? lastResolvedId : null
    if (playing && blockerId === null) {
      blockerId = powerSaveBlocker.start('prevent-display-sleep')
    } else if (!playing && blockerId !== null) {
      powerSaveBlocker.stop(blockerId)
      blockerId = null
    }
  })

  ipcMain.on(CH.playerTaskbar, (_e, next: TaskbarState) => {
    setTaskbarState(next)
  })

  ipcMain.handle(CH.historyAdd, (_e, entry: HistoryEntry): void => {
    lib().addHistory(entry)
  })

  ipcMain.handle(CH.historyForget, (_e, titles: string[]): number => {
    return lib().removeHistory(Array.isArray(titles) ? titles : [])
  })

  const historyEntries = (limit: number): HistoryEntry[] => {
    const known = trackStore().get()
    // Old entries predate thumbnails (and were written before catalog art
    // existed). Backfill from the track store so Recently played is never blank.
    return lib()
      .history(limit)
      .map((entry) => {
        const track = known[entry.trackId]
        return {
          ...entry,
          title: entry.title || track?.title || 'Unknown title',
          artist: entry.artist || track?.artist || '',
          artistId: entry.artistId ?? track?.artistId,
          artistParts: entry.artistParts ?? track?.artistParts,
          album: entry.album ?? track?.album,
          albumId: entry.albumId ?? track?.albumId,
          durationSec: entry.durationSec ?? track?.durationSec,
          thumbnail: entry.thumbnail ?? track?.thumbnail
        }
      })
  }

  ipcMain.handle(CH.historyList, (_e, limit?: number): HistoryEntry[] => historyEntries(limit ?? 100))

  ipcMain.handle(CH.historySummary, () =>
    summarizeHistory(historyEntries(5000), Date.now() - 7 * 24 * 60 * 60 * 1000)
  )

  ipcMain.handle(CH.favoritesList, (): Track[] => lib().favorites())

  ipcMain.handle(CH.favoritesToggle, (_e, track: Track) => {
    const result = lib().toggleFavorite(track)
    // Keep the Liked songs download snapshot in step: liking/unliking after the
    // collection was downloaded should not leave a stale coverage count.
    downloadsManager?.syncCollection(
      'liked',
      result.favorites.map((favorite) => favorite.id)
    )
    return result
  })

  // ---- playlists (PLAN §5.4) ----------------------------------------------
  ipcMain.handle(CH.libraryPlaylists, (): Playlist[] => lib().playlists())

  ipcMain.handle(CH.libraryPlaylistCreate, (_e, name: string): Playlist =>
    lib().createPlaylist(name)
  )

  ipcMain.handle(CH.libraryPlaylistRename, (_e, id: string, name: string): Playlist | null =>
    lib().renamePlaylist(id, name)
  )

  ipcMain.handle(CH.libraryPlaylistDelete, (_e, id: string): void => {
    lib().deletePlaylist(id)
    // Delete the download references, not the files another source still owns.
    downloadsManager?.removeCollection(`playlist:${id}`)
  })

  ipcMain.handle(CH.libraryPlaylistAdd, (_e, id: string, track: Track): Playlist | null => {
    const playlist = lib().addToPlaylist(id, track)
    if (playlist) downloadsManager?.syncCollection(`playlist:${id}`, playlist.tracks.map((t) => t.id))
    return playlist
  })

  ipcMain.handle(CH.libraryPlaylistRemove, (_e, id: string, trackId: string): Playlist | null => {
    const playlist = lib().removeFromPlaylist(id, trackId)
    if (playlist) {
      downloadsManager?.pruneCollection(`playlist:${id}`, playlist.tracks.map((t) => t.id))
    }
    return playlist
  })

  ipcMain.handle(CH.libraryAlbums, (): SavedAlbum[] => lib().albums())
  ipcMain.handle(
    CH.libraryAlbumToggle,
    (_e, album: SavedAlbum): { saved: boolean; albums: SavedAlbum[] } => lib().toggleAlbum(album)
  )

  ipcMain.handle(CH.importResolve, async (_e, url: string): Promise<Result<ImportSource>> => {
    const controller = new AbortController()
    importResolveController = controller
    try {
      return ok(await resolveImport(url, { signal: controller.signal }))
    } catch (err) {
      return fail(err)
    } finally {
      if (importResolveController === controller) importResolveController = null
    }
  })

  ipcMain.handle(
    CH.importMatch,
    async (event, source: ImportSource): Promise<Result<ImportMatch[]>> => {
      const job = { cancelled: false }
      importJob = job

      try {
        const matches = await matchImport(
          source,
          (done, total) => {
            if (event.sender.isDestroyed()) return
            event.sender.send(CH.importProgress, { done, total } satisfies ImportProgress)
          },
          () => job.cancelled
        )
        return ok(matches)
      } catch (err) {
        return fail(err)
      } finally {
        if (importJob === job) importJob = null
      }
    }
  )

  ipcMain.handle(CH.importCancel, (): void => {
    importResolveController?.abort()
    if (importJob) importJob.cancelled = true
  })

  ipcMain.handle(
    CH.importCreate,
    (_e, input: ImportCreateInput): Result<Playlist> => {
      try {
        const tracks = Array.isArray(input?.tracks) ? input.tracks : []
        if (tracks.length === 0) throw new Error('There are no tracks to import')

        const playlist = lib().createPlaylist(input.name?.trim() || 'Imported playlist')
        lib().addTracks(playlist.id, tracks)

        return ok(lib().playlists().find((entry) => entry.id === playlist.id) ?? playlist)
      } catch (err) {
        return fail(err)
      }
    }
  )

  ipcMain.handle(CH.cacheStats, () => cacheInstance().stats())

  ipcMain.handle(CH.cacheClear, () => {
    // Keep the track loaded in the player; deleting its file breaks seeking and
    // can make the unlink fail on Windows.
    cacheInstance().clear(playingTrackId ?? undefined)
    // Artwork is cache too, even though the Settings line reports audio only.
    imageCache().clear()
    return cacheInstance().stats()
  })

  ipcMain.handle(CH.imagesCache, (_e, urls: unknown): Promise<Record<string, string>> => {
    const list = Array.isArray(urls)
      ? urls.filter((url): url is string => typeof url === 'string')
      : []
    const art = imageCache()
    // Offline we can only answer with what is already on disk; fetching would
    // hang until the timeout and make the library flicker through placeholders.
    return networkMonitor.isOffline()
      ? Promise.resolve(art.localMany(list))
      : art.cacheMany(list)
  })

  ipcMain.handle(
    CH.imagesDataUrl,
    async (_e, src: unknown): Promise<{ src: string; type: string } | null> => {
      if (typeof src !== 'string') return null
      const file = mediaFileFor(src)
      if (!file) return null
      try {
        const bytes = await readFile(file)
        const type = mimeForPath(file)
        return { src: `data:${type};base64,${bytes.toString('base64')}`, type }
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(CH.ytdlpInfo, async (): Promise<Result<YtDlpInfo>> => {
    try {
      return ok(await runnerInfo())
    } catch (err) {
      return fail(err)
    }
  })

  ipcMain.handle(CH.ytdlpUpdate, async (): Promise<Result<YtDlpInfo>> => {
    try {
      return ok(await updateRunner())
    } catch (err) {
      return fail(err)
    }
  })
}

/**
 * Playback pipeline (PLAN §3).
 *
 * 1. Cached and known  → play the local file immediately, no network at all.
 * 2. Resolve a direct URL, and if the track is cache-worthy, start a background
 *    download so the next play is a hit.
 * 3. No direct URL available → download-to-cache and play from disk.
 */
async function resolveForPlayback(
  req: ResolveRequest,
  signal?: AbortSignal
): Promise<ResolveResult> {
  const input = req.input?.trim()
  if (!input) throw new Error('Nothing to play')

  const store = cacheInstance()
  const known = trackStore().get()
  const directId = Resolver.extractId(input)
  const offline = networkMonitor.isOffline()

  // 1. An explicit download always wins, even over a fresh URL. It is the one
  //    file the user asked us to keep. The exception is a forced recovery from a
  //    file stream: if the downloaded file itself failed to decode, handing the
  //    same file back makes recovery impossible. Bypass it for this attempt.
  if (directId) {
    const file = downloadStore().lookup(directId)
    const entry = downloadStore().entry(directId)
    if (file && entry && !(req.force && req.discardCache)) {
      const track = known[directId] ?? entry.track
      remember(track)
      return {
        track,
        stream: localStream(file, entry.ext, directId, 'download'),
        client: 'download',
        resolveMs: 0
      }
    }
  }

  if (req.discardCache && directId) store.remove(directId)

  // 2. The invisible cache is still a valid offline bonus when no explicit
  //    download exists. On a forced retry we normally bypass it, except offline,
  //    where a cached copy is better than a guaranteed failure.
  if (directId && (!req.force || offline)) {
    const file = store.lookup(directId)
    const track = known[directId]
    if (file && track) {
      store.touch(directId)
      return {
        track,
        stream: localStream(file, store.extOf(directId) ?? 'm4a', directId),
        client: 'cache',
        resolveMs: 0
      }
    }
  }

  if (offline) {
    throw new Error("You're offline. This song isn't downloaded.")
  }

  try {
    const result = await resolver.resolve(input, {
      force: req.force,
      signal,
      maxKbps: qualityCapKbps()
    })
    remember(result.track)
    kickOffBackgroundCache(result.track, input)
    return result
  } catch (err) {
    if (!(err instanceof NoDirectUrlError)) throw err

    // SABR-only: no playable URL, so fetch the audio and play it locally.
    const url = Resolver.normalizeInput(input)
    const downloaded = await resolver.download(url, signal, qualityCapKbps())
    let file: string
    try {
      file = store.put(
        downloaded.id,
        downloaded.file,
        downloaded.ext,
        playingTrackId ?? undefined
      )
    } finally {
      // The audio file was moved into the cache; the temp directory itself is
      // now empty and must not survive every SABR playback.
      rmSync(downloaded.dir, { recursive: true, force: true })
    }
    remember(err.track)
    return {
      track: err.track,
      stream: localStream(file, downloaded.ext, err.track.id),
      client: 'download',
      resolveMs: 0
    }
  }
}

function remember(track: Track): void {
  trackStore().update((d) => {
    d[track.id] = track
  })
}

/**
 * Cached files carry no bitrate metadata, but the cache index has the byte size
 * and the track store has the duration — enough to report the real average
 * bitrate in the player's quality tag.
 */
function localStream(
  file: string,
  ext: string,
  trackId: string,
  source: 'cache' | 'download' = 'cache'
): StreamInfo {
  let bitrateKbps: number | undefined
  try {
    const duration = trackStore().get()[trackId]?.durationSec ?? 0
    if (duration > 0) {
      bitrateKbps = Math.round((statSync(file).size * 8) / duration / 1000)
    }
  } catch {
    // A missing file surfaces as a playback error elsewhere; the tag can omit it.
  }

  return {
    url: mediaUrlFor(file),
    kind: 'file',
    ext,
    mime: mimeForPath(file),
    bitrateKbps,
    expiresAt: Number.MAX_SAFE_INTEGER,
    cached: source === 'cache',
    source
  }
}

function kickOffBackgroundCache(track: Track, input: string): void {
  const store = cacheInstance()
  if (store.has(track.id) || inflightDownloads.has(track.id)) return
  // A user-owned download already covers this track; do not duplicate the file.
  // A queued/running explicit download will produce that copy shortly.
  if (downloadStore().has(track.id) || downloadStore().job(track.id)) return

  const worth = shouldCache({
    favorited: lib().isFavorite(track.id),
    inOwnedPlaylist: false, // wired once playlists land in P2
    completion: lib().bestCompletion(track.id),
    playCount: lib().playCount(track.id)
  })
  if (!worth) return

  inflightDownloads.add(track.id)
  const controller = new AbortController()
  backgroundDownloadControllers.add(controller)
  resolver
    .download(Resolver.normalizeInput(input), controller.signal, qualityCapKbps(), true)
    .then((downloaded) => {
      try {
        // The user may have started an explicit download while this ran. The
        // explicit copy wins; cache the same bytes would waste space.
        if (downloadStore().has(downloaded.id) || downloadStore().job(downloaded.id)) {
          return
        }
        store.put(downloaded.id, downloaded.file, downloaded.ext, playingTrackId ?? undefined)
      } finally {
        rmSync(downloaded.dir, { recursive: true, force: true })
      }
    })
    .catch(() => {
      // A failed opportunistic download is not worth surfacing: playback
      // already succeeded over the network.
    })
    .finally(() => {
      backgroundDownloadControllers.delete(controller)
      inflightDownloads.delete(track.id)
    })
}

/** Resolve a media URL to a file, but only inside the cache/download folders. */
function mediaFileFor(url: string): string | null {
  let requested: string
  try {
    requested = pathFromMediaUrl(url)
  } catch {
    return null
  }
  const file = resolve(requested)
  const userData = app.getPath('userData')
  const allowed = [join(userData, 'cache'), join(userData, 'downloads')]
  return allowed.some((root) => file === root || file.startsWith(root + sep)) ? file : null
}

/** Serve cached audio over the privileged scheme registered in index.ts. */
export function handleMediaProtocol(): void {
  // Chromium only lets you seek a resource that advertises byte ranges.
  // `net.fetch(file://)` answers with a plain 200 and no Range support, so every
  // cached track was unseekable: dragging the scrubber snapped back to zero.
  // Serving real 206 partial responses fixes it.
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = mediaFileFor(request.url)
    if (!file) return new Response('Not found', { status: 404 })

    let total: number
    try {
      total = (await stat(file)).size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const headers = {
      'Content-Type': mimeForPath(file),
      'Accept-Ranges': 'bytes'
    }

    const range = request.headers.get('Range')
    if (!range) {
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
        status: 200,
        headers: { ...headers, 'Content-Length': String(total) }
      })
    }

    const suffix = /^bytes=-(\d+)$/.exec(range)
    let start: number
    let end: number

    if (suffix) {
      // `bytes=-500` means the last 500 bytes, not the first 500.
      start = Math.max(0, total - Number(suffix[1]))
      end = total - 1
    } else {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      start = match?.[1] ? Number(match[1]) : 0
      end = match?.[2] ? Number(match[2]) : total - 1
    }

    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= total) end = total - 1

    if (start > end) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${total}` }
      })
    }

    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(end - start + 1)
      }
    })
  })
}
