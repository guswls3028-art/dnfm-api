import type { Context, Next } from "hono";
import { randomUUID } from "node:crypto";

/**
 * 들어온 요청마다 ID 부여. 응답 헤더 X-Request-Id 로 노출.
 * 클라이언트가 X-Request-Id 헤더 보내면 그대로 사용 (분산 트레이스).
 */
export async function requestIdMiddleware(c: Context, next: Next) {
  const incoming = c.req.header("x-request-id");
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  await next();
}
