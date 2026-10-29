/**
 * Discord allows 5 activity updates per 20 seconds. Only the cap is enforced;
 * sends inside it are immediate. Forcing even spacing on top of the cap made
 * every track change wait up to four seconds for no benefit — a short
 * coalescing window in the presence manager already merges bursts.
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
    if (this.sentAt.length < this.limit) return 0
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
