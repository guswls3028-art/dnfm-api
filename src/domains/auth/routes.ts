import "@/shared/http/hono-env.js";
import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  localSignupDto,
  localLoginDto,
  updateProfileDto,
  changePasswordDto,
  deleteAccountDto,
  adminResetPasswordDto,
} from "./dto.js";
import {
  localSignup,
  localLogin,
  logoutByRefresh,
  rotateRefreshToken,
  updateUserProfile,
  changePassword,
  deleteOwnAccount,
  adminResetPassword,
  isUsernameAvailable,
  isDisplayNameAvailable,
  getLocalUsername,
  getMustChangePassword,
  type AuthTokens,
} from "./service.js";
import { env } from "@/config/env.js";
import { authRateLimit } from "@/shared/http/middleware/rate-limit.js";
import { ok, created } from "@/shared/http/response.js";
import { requireAuth } from "@/shared/http/middleware/auth.js";
import { getAllUserSiteRoles, isSuper } from "@/shared/auth/permissions.js";
import { AppError } from "@/shared/errors/app-error.js";
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

function publicUser(
  user: User,
  username?: string | null,
  extras?: { mustChangePassword?: boolean },
) {
  return {
    id: user.id,
    username: username ?? null,
    displayName: user.displayName,
    avatarR2Key: user.avatarR2Key,
    dnfProfile: user.dnfProfile,
    viewerPlatform: user.viewerPlatform ?? null,
    viewerNickname: user.viewerNickname ?? null,
    mustChangePassword: extras?.mustChangePassword ?? false,
    createdAt: user.createdAt,
  };
}

/**
 * GET /auth/check-availability?username=X 또는 ?displayName=Y
 *   회원가입 화면에서 실시간 중복 검사용 (debounced).
 *   응답: { available: boolean, reason?: string }
 *
 *   둘 다 들어오면 둘 다 검사해서 둘 다 사용 가능할 때만 available=true.
 *   둘 다 비어있으면 400.
 */
const checkAvailabilityQuery = z.object({
  username: z
    .string()
    .trim()
    .min(3, "아이디는 3자 이상이어야 합니다.")
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "영문/숫자/언더스코어만 사용할 수 있습니다.")
    .optional(),
  displayName: z.string().trim().min(1).max(32).optional(),
});

auth.get("/check-availability", zValidator("query", checkAvailabilityQuery), async (c) => {
  const { username, displayName } = c.req.valid("query");
  if (!username && !displayName) {
    return ok(c, {
      available: false,
      reason: "username 또는 displayName 쿼리 파라미터가 필요합니다.",
    });
  }

  if (username) {
    const usernameOk = await isUsernameAvailable(username);
    if (!usernameOk) {
      return ok(c, { available: false, reason: "이미 사용 중인 아이디입니다." });
    }
  }
  if (displayName) {
    const displayNameOk = await isDisplayNameAvailable(displayName);
    if (!displayNameOk) {
      return ok(c, { available: false, reason: "이미 사용 중인 닉네임입니다." });
    }
  }
  return ok(c, { available: true });
});

/** POST /auth/signup/local */
auth.post("/signup/local", authRateLimit, zValidator("json", localSignupDto), async (c) => {
  const input = c.req.valid("json");
  const result = await localSignup(input, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  setAuthCookies(c, result.tokens);
  return created(c, { user: publicUser(result.user, input.username) });
});

/** POST /auth/login/local */
auth.post("/login/local", authRateLimit, zValidator("json", localLoginDto), async (c) => {
  const input = c.req.valid("json");
  const result = await localLogin(input, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  setAuthCookies(c, result.tokens);
  const must = await getMustChangePassword(result.user.id);
  return ok(c, { user: publicUser(result.user, input.username, { mustChangePassword: must }) });
});

/** POST /auth/logout */
auth.post("/logout", async (c) => {
  const refresh = getCookie(c, "refresh_token");
  if (refresh) await logoutByRefresh(refresh);
  clearAuthCookies(c);
  return ok(c, { ok: true });
});

/**
 * GET /auth/me — 현재 로그인 유저 정보 + 사이트별 role.
 *
 * siteRoles: [{ site, role }] — frontend 가 admin 버튼 분기에 사용.
 *   site = "*" 인 row 는 super (모든 사이트의 admin 권한).
 *   row 가 없는 사이트는 일반 member 로 간주.
 */
auth.get("/me", requireAuth(), async (c) => {
  const user = c.get("user");
  const [siteRoles, username, mustChangePassword] = await Promise.all([
    getAllUserSiteRoles(user.id),
    getLocalUsername(user.id),
    getMustChangePassword(user.id),
  ]);
  return ok(c, {
    user: { ...publicUser(user, username, { mustChangePassword }), siteRoles },
  });
});

/**
 * POST /auth/refresh — refresh token rotation.
 *   - 쿠키 refresh_token → verify → rotate → 새 access + 새 refresh
 *   - reuse 감지 시 tokenVersion bump (전 디바이스 강제 로그아웃)
 */
auth.post("/refresh", authRateLimit, async (c) => {
  const refresh = getCookie(c, "refresh_token");
  if (!refresh) {
    clearAuthCookies(c);
    return ok(c, { ok: false, reason: "no_refresh_cookie" }, undefined);
  }
  try {
    const result = await rotateRefreshToken(refresh, {
      userAgent: c.req.header("user-agent") ?? undefined,
      ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    });
    setAuthCookies(c, result.tokens);
    return ok(c, { user: publicUser(result.user) });
  } catch (err) {
    // refresh 실패 시 cookie 도 같이 정리
    clearAuthCookies(c);
    throw err;
  }
});

/**
 * PATCH /auth/me — 본인 프로필 수정.
 *   displayName / avatarR2Key / dnfProfile
 */
auth.patch("/me", requireAuth(), zValidator("json", updateProfileDto), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");
  const updated = await updateUserProfile(user.id, input);
  const [siteRoles, username] = await Promise.all([
    getAllUserSiteRoles(updated.id),
    getLocalUsername(updated.id),
  ]);
  return ok(c, { user: { ...publicUser(updated, username), siteRoles } });
});

/**
 * POST /auth/change-password — 비밀번호 변경.
 *   현재 비번 검증 + 새 비번 정책 + tokenVersion bump (전 세션 무효화).
 *   클라이언트는 응답 후 다시 로그인해야 함.
 */
auth.post(
  "/change-password",
  requireAuth(),
  authRateLimit,
  zValidator("json", changePasswordDto),
  async (c) => {
    const user = c.get("user");
    const input = c.req.valid("json");
    await changePassword(user.id, input);
    clearAuthCookies(c);
    return ok(c, { ok: true });
  },
);

/**
 * POST /auth/admin/reset-password — super 권한.
 *   body: { username }
 *   응답: { tempPassword, userId, displayName }
 *   사용자는 임시 비번으로 로그인 → mustChangePassword=true → /profile/password 강제 redirect.
 */
auth.post(
  "/admin/reset-password",
  requireAuth(),
  authRateLimit,
  zValidator("json", adminResetPasswordDto),
  async (c) => {
    const actor = c.get("user");
    const superOk = await isSuper(actor.id);
    if (!superOk) {
      throw AppError.forbidden("super 권한 전용입니다.", "super_only");
    }
    const { username } = c.req.valid("json");
    const result = await adminResetPassword(username);
    return ok(c, result);
  },
);

/**
 * DELETE /auth/me — 본인 회원 탈퇴.
 *   - 자체 가입자: body { password } 재확인 필수
 *   - OAuth-only 계정: password 생략 가능 (cookie 통과 + access token 이미 검증)
 *   - 성공 시 cookie 정리 + 200
 *
 * 정책: soft delete + PII anonymization. 작성 글/댓글의 authorId 는 보존 (작성 맥락 유지),
 *   user row 자체는 status='deleted' + displayName='(탈퇴) {prefix}' 로 익명화. tokenVersion bump.
 */
auth.delete(
  "/me",
  requireAuth(),
  authRateLimit,
  zValidator("json", deleteAccountDto),
  async (c) => {
    const user = c.get("user");
    const input = c.req.valid("json");
    await deleteOwnAccount(user.id, input);
    clearAuthCookies(c);
    return ok(c, { ok: true });
  },
);

/**
 * GET /auth/sessions — 본인 활성 refresh session 목록.
 *   응답: { sessions: [{ id, userAgent, ipAddress, createdAt, current }] }
 *   current=true 는 지금 사용 중인 refresh token 의 row.
 */
auth.get("/sessions", requireAuth(), async (c) => {
  const user = c.get("user");
  const { db } = await import("@/shared/db/client.js");
  const { refreshTokens } = await import("@/domains/auth/schema.js");
  const { eq, and, desc } = await import("drizzle-orm");
  const refresh = getCookie(c, "refresh_token");
  const sha = await import("node:crypto").then((m) => m.createHash);
  const currentHash = refresh ? sha("sha256").update(refresh).digest("hex") : null;

  const rows = await db
    .select({
      id: refreshTokens.id,
      tokenHash: refreshTokens.tokenHash,
      userAgent: refreshTokens.userAgent,
      ipAddress: refreshTokens.ipAddress,
      createdAt: refreshTokens.createdAt,
      expiresAt: refreshTokens.expiresAt,
    })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, user.id), eq(refreshTokens.revoked, false)))
    .orderBy(desc(refreshTokens.createdAt));

  const sessions = rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    current: currentHash !== null && r.tokenHash === currentHash,
  }));
  return ok(c, { sessions });
});

/**
 * DELETE /auth/sessions/:id — 본인 세션 1개 revoke.
 *   현재 세션이면 cookie 도 정리.
 */
auth.delete("/sessions/:id", requireAuth(), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!id) throw AppError.badRequest("세션 id 가 누락됐습니다.", "missing_session_id");
  const { db } = await import("@/shared/db/client.js");
  const { refreshTokens } = await import("@/domains/auth/schema.js");
  const { eq, and } = await import("drizzle-orm");

  const rows = await db
    .select()
    .from(refreshTokens)
    .where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, user.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw AppError.notFound("세션을 찾을 수 없습니다.", "session_not_found");
  if (row.revoked) {
    return ok(c, { ok: true, alreadyRevoked: true });
  }

  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(eq(refreshTokens.id, id));

  // 현재 세션 revoke 면 cookie 도 정리
  const refresh = getCookie(c, "refresh_token");
  if (refresh) {
    const sha = await import("node:crypto").then((m) => m.createHash);
    const currentHash = sha("sha256").update(refresh).digest("hex");
    if (currentHash === row.tokenHash) {
      clearAuthCookies(c);
    }
  }
  return ok(c, { ok: true });
});

/**
 * POST /auth/sessions/revoke-others — 본 세션을 제외한 모든 세션 revoke.
 *   "다른 디바이스에서 모두 로그아웃" 버튼용. tokenVersion bump 안 함 — 현 세션은 유지.
 */
auth.post("/sessions/revoke-others", requireAuth(), async (c) => {
  const user = c.get("user");
  const refresh = getCookie(c, "refresh_token");
  const { db } = await import("@/shared/db/client.js");
  const { refreshTokens } = await import("@/domains/auth/schema.js");
  const { eq, and, ne } = await import("drizzle-orm");

  if (!refresh) {
    // 현재 refresh 가 없으면 모든 세션 revoke
    await db
      .update(refreshTokens)
      .set({ revoked: true, revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, user.id), eq(refreshTokens.revoked, false)));
    return ok(c, { ok: true, revokedAll: true });
  }
  const sha = await import("node:crypto").then((m) => m.createHash);
  const currentHash = sha("sha256").update(refresh).digest("hex");

  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(
      and(
        eq(refreshTokens.userId, user.id),
        eq(refreshTokens.revoked, false),
        ne(refreshTokens.tokenHash, currentHash),
      ),
    );
  return ok(c, { ok: true });
});

/**
 * DELETE /auth/admin/cleanup-test-users — super 권한. E2E test user 정리.
 *   query: ?prefix=e2e_&maxAgeSec=86400&dryRun=1
 *   user 삭제 cascade — credentials/oauth/refresh 같이 삭제. posts.authorId set null.
 */
const cleanupQuery = z.object({
  prefix: z.string().trim().min(2).max(32),
  maxAgeSec: z.coerce.number().int().min(60).max(60 * 60 * 24 * 30).optional(),
  dryRun: z.coerce.boolean().optional(),
});

auth.delete(
  "/admin/cleanup-test-users",
  requireAuth(),
  zValidator("query", cleanupQuery),
  async (c) => {
    const actor = c.get("user");
    const superOk = await isSuper(actor.id);
    if (!superOk) {
      throw AppError.forbidden("super 권한 전용입니다.", "super_only");
    }
    const { prefix, maxAgeSec = 86400, dryRun } = c.req.valid("query");
    const { db } = await import("@/shared/db/client.js");
    const { users, userLocalCredentials } = await import("@/domains/auth/schema.js");
    const { sql, eq, lt, and, inArray } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - maxAgeSec * 1000);

    const candidates = await db
      .select({ id: users.id, displayName: users.displayName, createdAt: users.createdAt })
      .from(users)
      .innerJoin(userLocalCredentials, eq(userLocalCredentials.userId, users.id))
      .where(
        and(
          sql`${userLocalCredentials.username} LIKE ${prefix + "%"}`,
          lt(users.createdAt, cutoff),
        ),
      );

    if (dryRun || candidates.length === 0) {
      return ok(c, { matched: candidates.length, dryRun: true, items: candidates });
    }
    const ids = candidates.map((u) => u.id);
    await db.delete(users).where(inArray(users.id, ids));
    return ok(c, { deleted: candidates.length, items: candidates });
  },
);

/**
 * Sub-routers mount.
 *   /auth/dnf-profile/ocr/:type  (multipart)
 *   /auth/dnf-profile/ocr/auto   (multipart, multi)
 *   /auth/dnf-profile/confirm
 *   /auth/oauth/:provider/start
 *   /auth/oauth/:provider/callback
 */
auth.route("/dnf-profile", ocrRoutes);
auth.route("/oauth", oauthRoutes);

export default auth;
