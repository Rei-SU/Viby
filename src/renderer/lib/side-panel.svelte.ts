export type SidePanelMode = 'lyrics' | 'queue' | 'history' | 'downloads'

/**
 * One docked panel, several contents. The player-bar buttons switch it, and
 * clicking the active mode closes it. Keeping the mode here (rather than in a
 * component) means the dock, the panel shell, the lyrics loader and the
 * downloads trigger all agree on what is open without prop drilling.
 */
class SidePanelState {
  mode = $state<SidePanelMode | null>(null)

  get open(): boolean {
    return this.mode !== null
  }

  toggle(mode: SidePanelMode): void {
    this.mode = this.mode === mode ? null : mode
  }

  close(): void {
    this.mode = null
  }
}

export const sidePanel = new SidePanelState()
