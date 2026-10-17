// src/lib/rate-limit.ts
// 滑动窗口限流器（内存版）。
//
// 局限：计数只存在当前实例的内存里。Vercel 上同时可能有多个实例，每个实例各自计数，
// 实例重启后计数清零，所以这只是"尽力而为"的限流，不是全局一致的上限。
// 需要全局一致时，用共享存储（如 Redis）实现同一个 RateLimiter 接口替换即可，调用方不用改。

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** 被拒绝时，距离窗口内最早一次请求过期还有多少毫秒 */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

interface Options {
  limit: number;
  windowMs: number;
  /** 便于测试注入假时钟 */
  now?: () => number;
  /** key 数量超过该值时清理已过期的 key，防止内存无限增长 */
  maxKeys?: number;
}

export function createSlidingWindowLimiter({ limit, windowMs, now = Date.now, maxKeys = 10_000 }: Options): RateLimiter {
  const hits = new Map<string, number[]>();

  function sweep(current: number) {
    for (const [key, timestamps] of hits) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= current - windowMs) {
        hits.delete(key);
      }
    }
  }

  return {
    check(key) {
      const current = now();
      if (hits.size > maxKeys) sweep(current);

      // 只保留窗口内的请求时间戳
      const recent = (hits.get(key) ?? []).filter((t) => t > current - windowMs);

      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, remaining: 0, retryAfterMs: recent[0] + windowMs - current };
      }

      recent.push(current);
      hits.set(key, recent);
      return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
    },
  };
}
