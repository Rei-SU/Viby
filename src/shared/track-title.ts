/**
 * "Song (Official Video)", "Song [4K]" and "Song (feat. X)" are the same
 * recording as "Song". Used to pair a search result with the row a release
 * page actually lists, because searching often surfaces the video (or a
 * shorter title) while the release holds the audio. Version markers like live,
 * remix and acoustic are deliberately kept.
 */
export function trackTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\[(]\s*(?:feat|ft|featuring)\.?\s[^\])]*[)\]]/g, ' ')
    .replace(/\s+(?:feat|ft|featuring)\.?\s+.+$/i, ' ')
    .replace(
      /[\[(]\s*(?:official\s+)?(?:music\s+)?(?:video|audio|visuali[sz]er|lyric\s+video|hd|4k)\s*[\])]/g,
      ''
    )
    .replace(/\s*(?:official|lyric)\s+video\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
