/**
 * What the single <audio> element is holding when a queue track is started.
 *
 * `current` and `loadedId` are deliberately separate: a failed resolve moves
 * `current` to the new track while the element may still hold the previous
 * source. Reusing that source because `audio.src` is non-empty is what played
 * the old song under the new title on a second click.
 */
export type SourceAction = 'reuse' | 'detach' | 'keep'

export function sourceAction(
  currentId: string | null | undefined,
  loadedId: string | null,
  trackId: string,
  hasSrc: boolean
): SourceAction {
  // Reuse only when the element really holds the track the UI is asking for.
  if (currentId === trackId && loadedId === trackId && hasSrc) return 'reuse'
  // A source for another track must be detached before the new metadata is
  // adopted, so a retry cannot play it.
  if (loadedId !== trackId) return 'detach'
  return 'keep'
}
