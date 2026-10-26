/**
 * Shared quit and close behavior for the main process. A hidden window is only
 * safe when a tray icon exists, so `backgroundReady` tracks that rather than the
 * saved setting.
 */
let quitting = false
let backgroundReady = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

export function setBackgroundReady(ready: boolean): void {
  backgroundReady = ready
}

export function shouldHideOnClose(): boolean {
  return backgroundReady && !quitting
}

export function keepsAppAlive(): boolean {
  return backgroundReady && !quitting
}
