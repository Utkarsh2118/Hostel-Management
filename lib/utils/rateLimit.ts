interface RateBucket {
  timestamps: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * In-memory per-user sliding-window rate limiter to protect write and AI endpoints.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, RateBucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  public check(key: string, nowMs = Date.now()): RateLimitResult {
    const cutoff = nowMs - this.windowMs;
    const existing = this.buckets.get(key) ?? { timestamps: [] };
    const recent = existing.timestamps.filter((t) => t > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldest = recent[0] ?? nowMs;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
      this.buckets.set(key, { timestamps: recent });
      return { allowed: false, remaining: 0, retryAfterSec };
    }

    recent.push(nowMs);
    this.buckets.set(key, { timestamps: recent });
    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - recent.length),
      retryAfterSec: 0,
    };
  }
}
