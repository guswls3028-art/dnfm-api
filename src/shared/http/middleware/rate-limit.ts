import type { Context, Next } from "hono";
import { AppError } from "@/shared/errors/app-error.js";

/**
 * 간이 rate limit — in-memory sliding window.
 *
 * Production 권장: Redis (Cloudflare KV / Upstash 등) 으로 multi-instance.
 * 현재 dnfm-api 는 단일 EC2 fork mode 이라 in-memory 충분.
 *
 * key 정책:
 *   - 인증 endpoint: IP 기반 (signup/login 브루트포스 방어)
 *   - 작성 endpoint: userId 기반 (도배 방어)
 *
 * 한도 초과 → 429 Too Many Requests + 남은 reset 시간.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// 메모리 누수 방지 — 매 5분마다 만료된 bucket cleanup
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

export interface RateLimitOptions {
  /** 윈도우 길이 (초) */
  windowSec: number;
  /** 윈도우 내 최대 요청 수 */
  max: number;
  /** key 추출 함수. 미지정 시 IP 기반. */
  keyFn?: (c: Context) => string;
  /** 한도 초과 시 에러 메시지 */
  message?: string;
}

function defaultKey(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  const ip = xff?.split(",")[0]?.trim() || c.req.header("cf-connecting-ip") || "unknown";
  return `ip:${ip}`;
}

export function rateLimit(opts: RateLimitOptions) {
  const windowMs = opts.windowSec * 1000;
  return async (c: Context, next: Next) => {
    const key = (opts.keyFn ?? defaultKey)(c) + ":" + c.req.path;
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt < now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (existing.count >= opts.max) {
      const remaining = Math.ceil((existing.resetAt - now) / 1000);
      c.header("Retry-After", String(remaining));
      throw AppError.tooManyRequests(
        opts.message ?? `요청이 너무 많습니다. ${remaining}초 후 다시 시도해주세요.`,
      );
    }

    existing.count += 1;
    await next();
  };
}

/** 인증 — IP 기반, 분당 10회 (signup/login 브루트포스 방어) */
export const authRateLimit = rateLimit({
  windowSec: 60,
  max: 10,
  message: "로그인/가입 시도가 너무 많습니다. 1분 후 다시 시도해주세요.",
});

/** 작성 — userId 기반 fallback IP. 분당 20회 (도배 방어) */
export const writeRateLimit = rateLimit({
  windowSec: 60,
  max: 20,
  keyFn: (c) => {
    const userId = c.get("userId") as string | undefined;
    if (userId) return `user:${userId}`;
    return defaultKey(c);
  },
  message: "작성이 너무 빠릅니다. 잠시 후 다시 시도해주세요.",
});

/** OCR — userId 기반, 분당 6회 (Vision API 비용 보호) */
export const ocrRateLimit = rateLimit({
  windowSec: 60,
  max: 6,
  keyFn: (c) => {
    const userId = c.get("userId") as string | undefined;
    if (userId) return `user:${userId}`;
    return defaultKey(c);
  },
  message: "OCR 호출이 너무 잦습니다. 잠시 후 다시 시도해주세요.",
});
