/**
 * YouTube Music's web ("WEB_REMIX") client constants.
 *
 * These rotate occasionally, which is risk R2 in the plan. Everything lives here
 * so a fix is a one-file patch — and `resolve()` can fall back to yt-dlp metadata
 * if these ever stop working.
 */
export const INNERTUBE = {
  apiKey: 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30',
  clientName: 'WEB_REMIX',
  clientVersion: '1.20241001.01.00',
  hl: 'en',
  gl: 'US',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  endpoint: 'https://music.youtube.com/youtubei/v1',
  origin: 'https://music.youtube.com'
} as const

/** Search filter params, base64 protobufs the web client sends. */
export const SEARCH_FILTERS = {
  all: undefined,
  songs: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D',
  albums: 'EgWKAQIYAWoKEAkQChAFEAMQBA%3D%3D',
  artists: 'EgWKAQIgAWoKEAkQChAFEAMQBA%3D%3D',
  playlists: 'EgWKAQIoAWoKEAkQChAFEAMQBA%3D%3D'
} as const

export type SearchFilter = keyof typeof SEARCH_FILTERS
