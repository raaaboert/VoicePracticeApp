/** Process-wide overload protection, independent of all caller-supplied identities.
 * Account security limits live in AuthVerificationStore; this is a short burst
 * and concurrency guard, never a long-lived shared proxy-IP lockout. */
export class AnonymousAbuseGuard {
  private tokens: number;
  private checkedAt: number;
  private active = 0;
  constructor(private readonly burst = 200, private readonly perSecond = 100,
    private readonly concurrent = 16, private readonly clock = Date.now) {
    this.tokens = burst; this.checkedAt = clock();
  }
  acquire(): (() => void) | null {
    const now = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.checkedAt) * this.perSecond / 1000);
    this.checkedAt = now;
    if (this.tokens < 1 || this.active >= this.concurrent) return null;
    this.tokens--; this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  resetForTest(): void {
    if (process.env.NODE_ENV !== "test") throw new Error("Overload reset is test-only.");
    this.tokens = this.burst;
    this.checkedAt = this.clock();
  }
}
