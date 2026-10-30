const AUDIO_EXTENSIONS = new Set(['m4a', 'webm', 'opus', 'mp3', 'ogg', 'aac', 'flac', 'wav'])

/** Ids become file names; never let one escape or alias another path. */
export function safeFileId(trackId: string): string {
  return String(trackId).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96)
}

/** Audio containers we are willing to index or serve. */
export function safeAudioExtension(ext: string): string {
  const clean = String(ext).trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  return AUDIO_EXTENSIONS.has(clean) ? clean : 'm4a'
}

export function isAudioExtension(ext: string): boolean {
  return AUDIO_EXTENSIONS.has(ext)
}
