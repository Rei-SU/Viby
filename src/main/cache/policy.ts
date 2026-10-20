export type CacheDecisionInput = {
  favorited: boolean
  inOwnedPlaylist: boolean
  completion: number
  playCount: number
}

/**
 * Cache-worthiness (PLAN §6). One-off exploration streams and leaves nothing
 * behind, so the cache holds things you actually listen to.
 */
export function shouldCache(input: CacheDecisionInput): boolean {
  return (
    input.favorited ||
    input.inOwnedPlaylist ||
    input.completion >= 0.5 ||
    input.playCount >= 2
  )
}
