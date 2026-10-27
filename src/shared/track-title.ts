/**
 * "Song (Official Video)" and "Song [4K]" are the same recording as "Song".
 * Used to pair a search result with the row a release page actually lists,
 * because searching often surfaces the video while the release holds the audio.
 */
export function trackTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(
      /[\[(]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|visuali[sz]er|lyric\s+video|hd|4k)\s*[\])]/g,
      ''
    )
    .replace(/\s*(?:official|lyric)\s+video\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
