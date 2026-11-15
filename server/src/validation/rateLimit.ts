/**
 * Token-bucket rate limiter, one bucket per key (typically socket id + event name).
 * Cheap enough to run on every inbound socket event.
 */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns true if the action is allowed (and consumes a token). */
  take(key: string, cost = 1): boolean {
    const t = this.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: t };
    const elapsed = (t - b.updatedAt) / 1000;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSecond);
    b.updatedAt = t;
    const allowed = b.tokens >= cost;
    if (allowed) b.tokens -= cost;
    this.buckets.set(key, b);
    return allowed;
  }

  /** Forget all buckets whose key starts with `prefix` (e.g. on socket disconnect). */
  clear(prefix: string): void {
    for (const k of this.buckets.keys()) if (k.startsWith(prefix)) this.buckets.delete(k);
  }

  get size(): number {
    return this.buckets.size;
  }
}
