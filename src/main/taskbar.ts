import { join } from 'node:path'
import {
  app,
  nativeImage,
  nativeTheme,
  type BrowserWindow,
  type NativeImage,
  type ThumbarButton
} from 'electron'
import { CH, type PlayerCommand, type TaskbarState } from '@shared/ipc'
import { getMainWindow } from './windows'

/**
 * Windows shows a thumbnail toolbar when you hover the app's taskbar button.
 * Spotify and every other media app put play/pause, previous and next there;
 * without `setThumbarButtons` the preview is just a screenshot of the window.
 *
 * The shell draws the supplied bitmaps as-is, so the glyphs have to match the
 * taskbar: white on a dark system UI, near-black on a light one.
 */

type Icons = Record<'previous' | 'play' | 'pause' | 'next', NativeImage>

let state: TaskbarState | null = null
let icons: Icons | null = null
let iconsAreDark: boolean | null = null
/** Windows rejects the toolbar until the window owns a taskbar button. */
const awaitingShow = new WeakSet<BrowserWindow>()

function iconDir(): string {
  const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(base, 'thumbar')
}

function loadIcons(): Icons | null {
  // `shouldUseDarkColorsForSystemIntegratedUI` follows the Windows mode that
  // colours the taskbar, which is not always the app mode.
  const dark = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
  if (icons && iconsAreDark === dark) return icons

  const folder = join(iconDir(), dark ? 'dark' : 'light')
  try {
    const load = (name: keyof Icons): NativeImage => {
      const image = nativeImage.createFromPath(join(folder, `${name}.png`))
      if (image.isEmpty()) throw new Error(`Missing ${name}.png`)
      return image
    }
    icons = {
      previous: load('previous'),
      play: load('play'),
      pause: load('pause'),
      next: load('next')
    }
    iconsAreDark = dark
    return icons
  } catch (error) {
    // A missing asset must not take playback down; the preview simply stays
    // without controls, which is what it looked like before this existed.
    console.error(`[taskbar] thumbnail icons unavailable (${folder})`, error)
    icons = null
    iconsAreDark = null
    return null
  }
}

function send(command: PlayerCommand): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send(CH.playerCommand, command)
}

function thumbarButton(
  tooltip: string,
  icon: NativeImage,
  enabled: boolean,
  command: PlayerCommand
): ThumbarButton {
  const button: ThumbarButton = { tooltip, icon, click: () => send(command) }
  // Never pass `flags: ['enabled']`. Electron translates it to `THB_FLAGS` with
  // an all-zero `dwFlags` and Windows rejects the entire toolbar (the call
  // returns false and nothing is drawn). Enabled is the default, so only a
  // disabled button needs the flag at all.
  if (!enabled) button.flags = ['disabled']
  return button
}

/** Draw the toolbar for the current player state on the given window. */
export function applyTaskbar(win: BrowserWindow): void {
  if (process.platform !== 'win32' || win.isDestroyed()) return

  // The first player state arrives before `ready-to-show`. A hidden window has
  // no taskbar button yet, and Windows answers `setThumbarButtons` with false.
  // Wait for the window to appear, then draw the current state once.
  if (!win.isVisible()) {
    if (!awaitingShow.has(win)) {
      awaitingShow.add(win)
      win.once('show', () => {
        awaitingShow.delete(win)
        applyTaskbar(win)
      })
    }
    return
  }

  if (!state?.hasTrack) {
    win.setThumbarButtons([])
    return
  }

  const set = loadIcons()
  if (!set) return

  win.setThumbarButtons([
    thumbarButton('Previous', set.previous, state.canPrevious, 'previous'),
    thumbarButton(
      state.playing ? 'Pause' : 'Play',
      state.playing ? set.pause : set.play,
      true,
      'toggle'
    ),
    thumbarButton('Next', set.next, state.canNext, 'next')
  ])
}

/** Called from the renderer whenever playback, the track or the queue changes. */
export function setTaskbarState(next: TaskbarState): void {
  if (process.platform !== 'win32') return
  state = next
  const win = getMainWindow()
  if (win) applyTaskbar(win)
}

/** Re-render the icons when the user switches between light and dark Windows. */
export function initTaskbar(): void {
  if (process.platform !== 'win32') return
  nativeTheme.on('updated', () => {
    icons = null
    iconsAreDark = null
    const win = getMainWindow()
    if (win && state) applyTaskbar(win)
  })
}
