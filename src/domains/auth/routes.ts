import "@/shared/http/hono-env.js";
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { localSignupDto, localLoginDto } from "./dto.js";
import { localSignup, localLogin, logoutByRefresh, type AuthTokens } from "./service.js";
import { env } from "@/config/env.js";
import { ok, created } from "@/shared/http/response.js";
import { requireAuth } from "@/shared/http/middleware/auth.js";
import type { User } from "./schema.js";
import ocrRoutes from "./ocr-routes.js";
import oauthRoutes from "./oauth-routes.js";

const auth = new Hono();

/** 두 쿠키 (access / refresh) 일관 설정. sibling subdomain 공유. */
function setAuthCookies(c: Parameters<typeof setCookie>[0], tokens: AuthTokens) {
  setCookie(c, "access_token", tokens.accessToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    domain: env.COOKIE_DOMAIN,
    path: "/",
    expires: tokens.accessExpiresAt,
  });
  setCookie(c, "refresh_token", tokens.refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    domain: env.COOKIE_DOMAIN,
    path: "/auth", // refresh 는 /auth/* 만 보냄
    expires: tokens.refreshExpiresAt,
  });
}

function clearAuthCookies(c: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(c, "access_token", { domain: env.COOKIE_DOMAIN, path: "/" });
  deleteCookie(c, "refresh_token", { domain: env.COOKIE_DOMAIN, path: "/auth" });
}

function publicUser(user: User) {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    avatarR2Key: user.avatarR2Key,
    dnfProfile: user.dnfProfile,
    createdAt: user.createdAt,
  };
}

/** POST /auth/signup/local */
auth.post("/signup/local", zValidator("json", localSignupDto), async (c) => {
  const input = c.req.valid("json");
  const result = await localSignup(input, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  setAuthCookies(c, result.tokens);
  return created(c, { user: publicUser(result.user) });
});

/** POST /auth/login/local */
auth.post("/login/local", zValidator("json", localLoginDto), async (c) => {
  const input = c.req.valid("json");
  const result = await localLogin(input, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  setAuthCookies(c, result.tokens);
  return ok(c, { user: publicUser(result.user) });
});

/** POST /auth/logout */
auth.post("/logout", async (c) => {
  const refresh = getCookie(c, "refresh_token");
  if (refresh) await logoutByRefresh(refresh);
  clearAuthCookies(c);
  return ok(c, { ok: true });
});

/** GET /auth/me — 현재 로그인 유저 정보. */
auth.get("/me", requireAuth(), async (c) => {
  const user = c.get("user");
  return ok(c, { user: publicUser(user) });
});

/**
 * Sub-routers mount.
 *   /auth/dnf-profile/ocr/:type  (multipart)
 *   /auth/dnf-profile/confirm
 *   /auth/oauth/:provider/start
 *   /auth/oauth/:provider/callback
 */
auth.route("/dnf-profile", ocrRoutes);
auth.route("/oauth", oauthRoutes);

/**
 * TODO Stage 2 — refresh token rotation:
 *   - POST /auth/refresh
 */

export default auth;
