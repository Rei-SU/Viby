/**
 * Local audio files are served over a custom scheme rather than file://, which
 * Chromium blocks from an http origin in dev and which would need webSecurity
 * disabled. Registering a privileged scheme keeps every security flag on.
 */
export const MEDIA_SCHEME = 'viby-media'

export function mediaUrlFor(absPath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(absPath)}`
}

export function pathFromMediaUrl(url: string): string {
  const parsed = new URL(url)
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''))
}

export function mimeForPath(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'webm':
      return 'audio/webm'
    case 'opus':
    case 'ogg':
      return 'audio/ogg'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
    case 'mp4':
    default:
      return 'audio/mp4'
  }
}
