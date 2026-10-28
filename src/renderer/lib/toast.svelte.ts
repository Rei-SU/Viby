/**
 * One transient message at a time, rendered by the app's toast chip.
 *
 * Deliberately tiny: queue drops need a confirmation that is not a banner and
 * not a dialog, and the app already had exactly one toast style ("Back online")
 * to reuse.
 */
class ToastState {
  message = $state('')

  private timer: ReturnType<typeof setTimeout> | null = null

  show(message: string, ms = 2400): void {
    this.message = message
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.message = ''
      this.timer = null
    }, ms)
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.message = ''
  }
}

export const toast = new ToastState()
