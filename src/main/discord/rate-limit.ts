/**
 * Discord allows 5 activity updates per 20 seconds. The limiter both caps the
 * window and spaces sends out, so a burst of skips cannot exhaust the budget
 * and leave the final track waiting.
 */
export class UpdateRateLimiter {
  private sentAt: number[] = []

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 20_000,
    private readonly now: () => number = Date.now
  ) {}

  /** Milliseconds to wait before the next send; 0 means now. */
  delay(): number {
    const now = this.now()
    this.prune(now)
    if (this.sentAt.length < this.limit) {
      const last = this.sentAt[this.sentAt.length - 1]
      const spacing = this.windowMs / this.limit
      return last === undefined ? 0 : Math.max(0, last + spacing - now)
    }
    return Math.max(0, this.sentAt[0] + this.windowMs - now)
  }

  record(): void {
    const now = this.now()
    this.prune(now)
    this.sentAt.push(now)
  }

  reset(): void {
    this.sentAt = []
  }

  private prune(now: number): void {
    while (this.sentAt.length > 0 && this.sentAt[0] <= now - this.windowMs) {
      this.sentAt.shift()
    }
  }
}
