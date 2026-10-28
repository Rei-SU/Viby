import type { CatalogItem } from '@shared/types'

/**
 * The custom drag type every row publishes. The browser protects drag data
 * while the pointer is moving: `dragover` can see the type list but not the
 * payload, which is only readable again on `drop`. Drop targets need to know
 * *which* song is coming before that, so the row publishes it here and the
 * targets read the store.
 */
export const TRACK_DRAG_TYPE = 'application/x-viby-track'

class TrackDragState {
  /** The song currently being dragged, or null when nothing is in flight. */
  item = $state<CatalogItem | null>(null)
  /** The row the drag started from, so the source can dim while lifted. */
  sourceId = $state<string | null>(null)

  get active(): boolean {
    return this.item !== null
  }

  begin(item: CatalogItem): void {
    this.item = item
    this.sourceId = item.id
  }

  end(): void {
    this.item = null
    this.sourceId = null
  }
}

export const trackDrag = new TrackDragState()

/** True when the drag in flight is one of our song rows. */
export function isTrackDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes(TRACK_DRAG_TYPE) ?? false
}
