import type { StreamInfo } from '@shared/types'

/** The codec the stream actually is, not what the quality setting asked for. */
export function codecLabel(ext: string | undefined): string | null {
  switch (ext) {
    case 'm4a':
    case 'mp4':
      return 'AAC'
    case 'webm':
    case 'opus':
    case 'ogg':
      return 'OPUS'
    case 'mp3':
      return 'MP3'
    default:
      return ext ? ext.toUpperCase() : null
  }
}

export function qualityLabel(stream: StreamInfo | null): string | null {
  const codec = codecLabel(stream?.ext)
  if (!codec) return null
  return `${codec}${stream?.bitrateKbps ? ` ${stream.bitrateKbps}k` : ''}`
}
