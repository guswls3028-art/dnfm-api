import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../../shared/db/client.js";
import {
  users,
  userOauthAccounts,
  oauthProviders,
  type OAuthProvider,
  type User,
} from "./schema.js";
import { issueTokens, type AuthTokens } from "./service.js";
import { env } from "../../config/env.js";
import { ok } from "../../shared/http/response.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../config/logger.js";

/**
 * OAuth (Google / Kakao) — same flow:
 *   GET  /auth/oauth/:provider/start     → 302 redirect to provider authorize URL
 *   GET  /auth/oauth/:provider/callback  → exchange code → userinfo → upsert user → cookies
 *
 * Linking policy:
 *   - (provider, providerUserId) 매칭되는 oauth_account 있으면 그 user 로 로그인
 *   - 없고 providerEmail 이 기존 user.email 과 일치 → 그 user 에 자동 link
 *   - 둘 다 없으면 신규 user 생성 + oauth_account 발급
 *
 * CSRF: 단순 random hex state 를 cookie 에 저장, callback 에서 비교.
 * 키 미설정 시 endpoint 가 503 + 명확한 메시지 반환.
 */
const oauthRoutes = new Hono();

const STATE_COOKIE_NAME = "oauth_state";
const STATE_TTL_SECONDS = 600;

/* -------------------------------------------------------------------------- */
/* provider 설정                                                              */
/* -------------------------------------------------------------------------- */

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scope: string;
}

function getProviderConfig(provider: OAuthProvider): ProviderConfig | null {
  if (provider === "google") {
    if (
      !env.GOOGLE_OAUTH_CLIENT_ID ||
      !env.GOOGLE_OAUTH_CLIENT_SECRET ||
      !env.GOOGLE_OAUTH_REDIRECT_URI
    ) {
      return null;
    }
    return {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    };
  }
  if (provider === "kakao") {
    if (!env.KAKAO_OAUTH_CLIENT_ID || !env.KAKAO_OAUTH_REDIRECT_URI) {
      return null;
    }
    return {
      clientId: env.KAKAO_OAUTH_CLIENT_ID,
      clientSecret: env.KAKAO_OAUTH_CLIENT_SECRET,
      redirectUri: env.KAKAO_OAUTH_REDIRECT_URI,
      authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
      tokenUrl: "https://kauth.kakao.com/oauth/token",
      userinfoUrl: "https://kapi.kakao.com/v2/user/me",
      scope: "profile_nickname account_email",
    };
  }
  return null;
}

function parseProvider(raw: string | undefined): OAuthProvider {
  const parsed = oauthProviders.find((p) => p === raw);
  if (!parsed) {
    throw AppError.badRequest("지원하지 않는 OAuth provider 입니다.", "invalid_provider", {
      provider: raw,
    });
  }
  return parsed;
}

/* -------------------------------------------------------------------------- */
/* token exchange + userinfo                                                  */
/* -------------------------------------------------------------------------- */

interface NormalizedProfile {
  providerUserId: string;
  email?: string | undefined;
  displayName: string;
}

async function exchangeCodeForToken(
  cfg: ProviderConfig,
  code: string,
): Promise<{ access_token: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
  });
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);

  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ status: res.status, text }, "oauth token exchange failed");
    throw AppError.unauthorized("OAuth 토큰 교환 실패", "oauth_token_failed");
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw AppError.unauthorized("OAuth access_token 누락", "oauth_token_missing");
  }
  return { access_token: data.access_token };
}

function normalizeProviderProfile(
  provider: OAuthProvider,
  raw: Record<string, unknown>,
): NormalizedProfile {
  if (provider === "google") {
    const sub = String(raw.sub ?? "");
    const email = typeof raw.email === "string" ? raw.email : undefined;
    const name =
      (typeof raw.name === "string" && raw.name) ||
      (typeof raw.given_name === "string" && raw.given_name) ||
      email?.split("@")[0] ||
      "google_user";
    return { providerUserId: sub, email, displayName: name };
  }

  // kakao
  const idVal = raw.id;
  const id = typeof idVal === "number" ? String(idVal) : typeof idVal === "string" ? idVal : "";
  const account = (raw.kakao_account ?? {}) as Record<string, unknown>;
  const profile = (account.profile ?? {}) as Record<string, unknown>;
  const email = typeof account.email === "string" ? account.email : undefined;
  const nickname =
    (typeof profile.nickname === "string" && profile.nickname) ||
    (typeof (raw.properties as Record<string, unknown> | undefined)?.nickname === "string" &&
      ((raw.properties as Record<string, unknown>).nickname as string)) ||
    "kakao_user";
  return { providerUserId: id, email, displayName: nickname };
}

/* -------------------------------------------------------------------------- */
/* user upsert + link                                                         */
/* -------------------------------------------------------------------------- */

async function upsertOauthUser(
  provider: OAuthProvider,
  profile: NormalizedProfile,
  raw: Record<string, unknown>,
): Promise<User> {
  if (!profile.providerUserId) {
    throw AppError.unauthorized("OAuth providerUserId 누락", "oauth_user_id_missing");
  }

  // 1) 기존 oauth_account 매칭
  const existing = await db
    .select()
    .from(userOauthAccounts)
    .where(
      and(
        eq(userOauthAccounts.provider, provider),
        eq(userOauthAccounts.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(userOauthAccounts)
      .set({ lastLoginAt: new Date(), providerProfile: raw, providerEmail: profile.email ?? null })
      .where(eq(userOauthAccounts.id, existing[0].id));
    const u = await db.select().from(users).where(eq(users.id, existing[0].userId)).limit(1);
    if (!u[0]) throw AppError.internal("oauth account 의 user 가 사라졌습니다.");
    return u[0];
  }

  // 2) email 매칭 → 자동 link
  if (profile.email) {
    const byEmail = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
    if (byEmail[0]) {
      await db.insert(userOauthAccounts).values({
        userId: byEmail[0].id,
        provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
        providerProfile: raw,
        lastLoginAt: new Date(),
      });
      return byEmail[0];
    }
  }

  // 3) 신규 user 생성
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        displayName: profile.displayName.slice(0, 32),
        email: profile.email,
      })
      .returning();
    const user = inserted[0];
    if (!user) throw AppError.internal("user 생성 실패");
    await tx.insert(userOauthAccounts).values({
      userId: user.id,
      provider,
      providerUserId: profile.providerUserId,
      providerEmail: profile.email,
      providerProfile: raw,
      lastLoginAt: new Date(),
    });
    return user;
  });
}

/* -------------------------------------------------------------------------- */
/* cookie helpers                                                             */
/* -------------------------------------------------------------------------- */

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
    path: "/auth",
    expires: tokens.refreshExpiresAt,
  });
}

/* -------------------------------------------------------------------------- */
/* GET /auth/oauth/:provider/start                                            */
/* -------------------------------------------------------------------------- */

oauthRoutes.get("/:provider/start", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const cfg = getProviderConfig(provider);
  if (!cfg) {
    return c.json(
      {
        error: {
          code: "oauth_not_configured",
          message: `${provider} OAuth 환경 변수가 설정되어 있지 않습니다. 운영자에게 문의하세요.`,
        },
      },
      503,
    );
  }

  const state = randomBytes(16).toString("hex");
  setCookie(c, STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "Lax",
    domain: env.COOKIE_DOMAIN,
    path: "/auth",
    maxAge: STATE_TTL_SECONDS,
  });

  const url = new URL(cfg.authorizeUrl);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", cfg.scope);
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }

  return c.redirect(url.toString(), 302);
});

/* -------------------------------------------------------------------------- */
/* GET /auth/oauth/:provider/callback                                         */
/* -------------------------------------------------------------------------- */

oauthRoutes.get("/:provider/callback", async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const cfg = getProviderConfig(provider);
  if (!cfg) {
    return c.json(
      {
        error: {
          code: "oauth_not_configured",
          message: `${provider} OAuth 환경 변수가 설정되어 있지 않습니다.`,
        },
      },
      503,
    );
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const cookieState = getCookie(c, STATE_COOKIE_NAME);

  if (!code) throw AppError.badRequest("code 가 없습니다.", "oauth_code_missing");
  if (!state || !cookieState || state !== cookieState) {
    throw AppError.unauthorized("CSRF state 검증 실패", "oauth_state_mismatch");
  }
  // state 쿠키 즉시 삭제 (1회용)
  deleteCookie(c, STATE_COOKIE_NAME, { domain: env.COOKIE_DOMAIN, path: "/auth" });

  const { access_token } = await exchangeCodeForToken(cfg, code);

  // userinfo + raw (한 번만 호출, 응답 본문 재사용 위해 inline)
  const userinfoRes = await fetch(cfg.userinfoUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!userinfoRes.ok) {
    throw AppError.unauthorized("OAuth 사용자 정보 조회 실패", "oauth_userinfo_failed");
  }
  const raw = (await userinfoRes.json()) as Record<string, unknown>;
  const profile = normalizeProviderProfile(provider, raw);

  const user = await upsertOauthUser(provider, profile, raw);
  if (user.status !== "active") {
    throw AppError.forbidden("계정이 비활성화 상태입니다.", "account_inactive");
  }

  const tokens = await issueTokens(user.id, user.tokenVersion, {
    userAgent: c.req.header("user-agent") ?? undefined,
    ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });
  setAuthCookies(c, tokens);

  return ok(c, {
    user: {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      avatarR2Key: user.avatarR2Key,
      dnfProfile: user.dnfProfile,
    },
    provider,
  });
});

export default oauthRoutes;
