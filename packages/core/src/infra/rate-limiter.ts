import type { RedisHandle } from "./redis.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Fixed-window counter: at most `limit` hits per `windowSeconds` for `key`. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.buckets.set(key, b);
    }
    b.count++;
    if (this.buckets.size > 50_000) {
      for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
    }
    return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSeconds: Math.ceil((b.resetAt - now) / 1000) };
  }
}

/** Redis-backed limiter shared by all API instances; falls back to memory when Redis is unavailable. */
export class RedisRateLimiter implements RateLimiter {
  private readonly fallback = new MemoryRateLimiter();

  constructor(private readonly redis: RedisHandle) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    if (!this.redis.healthy()) return this.fallback.hit(key, limit, windowSeconds);
    try {
      const k = `rl:${key}`;
      const res = await this.redis.client.multi().incr(k).expire(k, windowSeconds, "NX").ttl(k).exec();
      const count = Number(res?.[0]?.[1] ?? 0);
      const ttl = Number(res?.[2]?.[1] ?? windowSeconds);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: Math.max(1, ttl) };
    } catch {
      return this.fallback.hit(key, limit, windowSeconds);
    }
  }
}
