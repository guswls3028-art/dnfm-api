import type { Context } from "hono";

/**
 * 클라이언트 IP 추출.
 * Cloudflare proxy 뒤라 cf-connecting-ip 가 가장 신뢰. fallback 으로 x-forwarded-for 첫 IP.
 */
export function getClientIp(c: Context): string | undefined {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim();
  return undefined;
}

export function getUserAgent(c: Context): string | undefined {
  return c.req.header("user-agent") || undefined;
}
