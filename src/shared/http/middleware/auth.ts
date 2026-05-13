import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { verifyAccessToken } from "@/shared/crypto/jwt.js";
import { db } from "@/shared/db/client.js";
import { users } from "@/domains/auth/schema.js";
import { AppError } from "@/shared/errors/app-error.js";

/**
 * 인증 미들웨어.
 *   - access token 은 httpOnly cookie "access_token" 에서 읽음.
 *   - JWT 검증 + DB 에서 user 조회 (token_version 비교로 강제 logout 반영).
 *   - 통과 시 c.set("userId", ...), c.set("user", ...) 설정.
 *   - 실패 시 401.
 *
 * 권한 (site role) 검사는 [[shared/http/middleware/require-site-role]] 에서 별도.
 * 이 미들웨어는 단순히 "로그인 했는가" 만 본다.
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, "access_token");
    if (!token) throw AppError.unauthorized("로그인이 필요합니다.", "auth_required");

    let payload: ReturnType<typeof verifyAccessToken>;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "session_expired");
    }

    const found = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    const user = found[0];
    if (!user) throw AppError.unauthorized("계정을 찾을 수 없습니다.", "user_not_found");
    if (user.status !== "active") {
      throw AppError.forbidden("계정이 비활성화 상태입니다.", "account_inactive");
    }
    // tokenVersion 검사 — change-password / 강제 logout 으로 bump 됐으면 기존 토큰 무효.
    // legacy access token (ver field 없음) 도 reject — 한 번 재로그인 필요.
    if (typeof payload.ver !== "number" || payload.ver !== user.tokenVersion) {
      throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "session_invalid");
    }

    c.set("userId", user.id);
    c.set("user", user);
    await next();
  };
}

/** optional auth — 로그인 됐으면 user 주입, 안 됐어도 통과. 공개 endpoint 의 개인화용. */
export function optionalAuth() {
  return async (c: Context, next: Next) => {
    const token = getCookie(c, "access_token");
    if (!token) return next();
    try {
      const payload = verifyAccessToken(token);
      const found = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
      const user = found[0];
      if (
        user &&
        user.status === "active" &&
        typeof payload.ver === "number" &&
        payload.ver === user.tokenVersion
      ) {
        c.set("userId", user.id);
        c.set("user", user);
      }
    } catch {
      // 무시 — optional 이라 fail 해도 통과
    }
    await next();
  };
}
