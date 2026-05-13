import jwt from "jsonwebtoken";
import { env } from "@/config/env.js";

/**
 * Access token  — 짧은 TTL. httpOnly cookie 로 전달, API 호출 시 검증.
 * Refresh token — 긴 TTL. 별도 cookie. /auth/refresh 호출 시에만 사용.
 *
 * payload 는 최소만 — 권한은 매 요청마다 DB 에서 조회 (token revoke 안 해도
 * password 변경 / role 박탈 즉시 반영되도록).
 */
export interface AccessTokenPayload {
  sub: string; // user_id
  typ: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  typ: "refresh";
  // rotation 추적용 jti (DB 의 refresh_token row id)
  jti: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: "access" } satisfies AccessTokenPayload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });
}

export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign(
    { sub: userId, typ: "refresh", jti } satisfies RefreshTokenPayload,
    env.JWT_REFRESH_SECRET,
    { expiresIn: env.JWT_REFRESH_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  if (decoded.typ !== "access") throw new Error("not an access token");
  return decoded;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  if (decoded.typ !== "refresh") throw new Error("not a refresh token");
  return decoded;
}
