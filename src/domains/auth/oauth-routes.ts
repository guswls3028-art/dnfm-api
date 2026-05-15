import "../../shared/http/hono-env.js";
import { Hono, type Context } from "hono";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { eq, and } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db } from "../../shared/db/client.js";
import {
  users,
  userLocalCredentials,
  userOauthAccounts,
  oauthProviders,
  type OAuthProvider,
  type User,
} from "./schema.js";
import { issueTokens, type AuthTokens } from "./service.js";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logger } from "../../config/logger.js";
import { SITE_CODES, type SiteCode } from "../../shared/types/site.js";
import { optionalAuth, requireAuth } from "../../shared/http/middleware/auth.js";

/**
 * OAuth (Google / Kakao) — same flow:
 *   GET  /auth/oauth/:provider/start     → 302 redirect to provider authorize URL
 *   GET  /auth/oauth/:provider/callback  → exchange code → userinfo → upsert user → cookies
 *
 * Login policy:
 *   - (provider, providerUserId) 매칭되는 oauth_account 있으면 그 user 로 로그인
 *   - 없으면 신규 user 생성 + oauth_account 발급
 *
 * Linking policy:
 *   - 로그인 상태에서 mode=link 로 시작한 callback 만 기존 user 에 provider 를 붙인다.
 *   - 이메일 자동 link 는 하지 않는다.
 *
 * CSRF: 단순 random hex state 를 cookie 에 저장, callback 에서 비교.
 * 키 미설정 시 endpoint 가 503 + 명확한 메시지 반환.
 */
const oauthRoutes = new Hono();

const STATE_COOKIE_NAME = "oauth_state";
const STATE_TTL_SECONDS = 600;

/** site host map — callback 성공/실패 시 frontend 로 302 redirect 할 origin. */
const SITE_HOSTS: Record<SiteCode, string> = {
  newb: "https://dnfm.kr",
  hurock: "https://hurock.dnfm.kr",
};

function parseSiteParam(raw: string | undefined | null): SiteCode {
  if (raw && (SITE_CODES as readonly string[]).includes(raw)) return raw as SiteCode;
  return "newb"; // default
}

function safeReturnTo(raw: string | undefined | null): string {
  if (!raw) return "/";
  if (typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

interface OAuthStatePayload {
  csrf: string;
  site: SiteCode;
  returnTo: string;
  mode?: "login" | "link";
  rememberMe?: boolean;
  linkUserId?: string;
}

function encodeStateCookie(payload: OAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

function decodeStateCookie(raw: string | undefined): OAuthStatePayload | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    const obj = JSON.parse(json) as Partial<OAuthStatePayload>;
    if (!obj.csrf || !obj.site) return null;
    if (!(SITE_CODES as readonly string[]).includes(obj.site)) return null;
    return {
      csrf: obj.csrf,
      site: obj.site,
      returnTo: safeReturnTo(obj.returnTo),
      mode: obj.mode === "link" ? "link" : "login",
      rememberMe: obj.rememberMe === false ? false : true,
      linkUserId: typeof obj.linkUserId === "string" ? obj.linkUserId : undefined,
    };
  } catch {
    return null;
  }
}

function parseRememberMe(raw: string | undefined | null): boolean {
  if (!raw) return true;
  const normalized = raw.toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "off";
}

function appendQuery(path: string, query: Record<string, string>): string {
  const [pathname, rawSearch = ""] = path.split("?");
  const safePathname = pathname || "/";
  const params = new URLSearchParams(rawSearch);
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  const s = params.toString();
  return s ? `${safePathname}?${s}` : safePathname;
}

function buildRedirect(
  site: SiteCode,
  pathWithQuery: string,
): string {
  const host = SITE_HOSTS[site];
  const path = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  return `${host}${path}`;
}

function redirectToFrontendError(c: Context, site: SiteCode, code: string): Response {
  // returnTo 정보는 state cookie 안에 들어있는데 fail 시 그 자체가 의심스러우니
  // /login?oauth_error=... 로만 유도. 사용자가 다시 시도하면 정상 path.
  const url = buildRedirect(site, `/login?oauth_error=${encodeURIComponent(code)}`);
  return c.redirect(url, 302);
}

function redirectToFrontendPathError(
  c: Context,
  site: SiteCode,
  path: string,
  code: string,
): Response {
  const url = buildRedirect(site, appendQuery(safeReturnTo(path), { oauth_error: code }));
  return c.redirect(url, 302);
}

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
      scope: "openid profile",
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
      scope: "profile_nickname",
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

interface UpsertOauthResult {
  user: User;
  /** 신규 user 생성 — frontend 가 닉네임 setup 페이지로 유도. */
  isNew: boolean;
}

async function upsertOauthUser(
  provider: OAuthProvider,
  profile: NormalizedProfile,
  raw: Record<string, unknown>,
): Promise<UpsertOauthResult> {
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
    return { user: u[0], isNew: false };
  }

  // 2) email 자동 link 폐기 — 사용자 정책 "이메일 안 받음" + scope email 미요청 정합.
  //    같은 provider 의 동일 userId 로만 link (위 1).

  // 3) 신규 user 생성. displayName placeholder — setup 페이지에서 사용자가 본인 닉으로 변경.
  const placeholder = `${provider}_${profile.providerUserId.slice(0, 8)}`;
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        displayName: placeholder,
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
    return { user, isNew: true };
  });
}

async function linkOauthAccountToUser(
  userId: string,
  provider: OAuthProvider,
  profile: NormalizedProfile,
  raw: Record<string, unknown>,
): Promise<User> {
  if (!profile.providerUserId) {
    throw AppError.unauthorized("OAuth providerUserId 누락", "oauth_user_id_missing");
  }

  const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") {
    throw AppError.unauthorized("계정을 사용할 수 없습니다.", "account_inactive");
  }

  const existingProviderUser = await db
    .select()
    .from(userOauthAccounts)
    .where(
      and(
        eq(userOauthAccounts.provider, provider),
        eq(userOauthAccounts.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1);
  const matchedAccount = existingProviderUser[0];
  if (matchedAccount && matchedAccount.userId !== userId) {
    throw AppError.conflict(
      "이미 다른 계정에 연동된 소셜 계정입니다.",
      "oauth_account_already_linked",
    );
  }
  if (matchedAccount) {
    await db
      .update(userOauthAccounts)
      .set({ lastLoginAt: new Date(), providerProfile: raw, providerEmail: profile.email ?? null })
      .where(eq(userOauthAccounts.id, matchedAccount.id));
    return user;
  }

  const existingProviderForUser = await db
    .select()
    .from(userOauthAccounts)
    .where(and(eq(userOauthAccounts.userId, userId), eq(userOauthAccounts.provider, provider)))
    .limit(1);
  if (existingProviderForUser[0]) {
    throw AppError.conflict(
      "이 계정에는 이미 같은 소셜 제공자가 연동되어 있습니다.",
      "oauth_provider_already_linked",
    );
  }

  await db.insert(userOauthAccounts).values({
    userId,
    provider,
    providerUserId: profile.providerUserId,
    providerEmail: profile.email,
    providerProfile: raw,
    lastLoginAt: new Date(),
  });
  return user;
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
    ...(tokens.rememberMe ? { expires: tokens.refreshExpiresAt } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* GET /auth/oauth/:provider/start                                            */
/* -------------------------------------------------------------------------- */

oauthRoutes.get("/:provider/start", optionalAuth(), async (c) => {
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

  // site / returnTo 쿼리 → state cookie 안에 묶어서 callback 에서 redirect target 결정.
  const site = parseSiteParam(c.req.query("site"));
  const returnTo = safeReturnTo(c.req.query("returnTo") ?? c.req.query("next"));
  const mode = c.req.query("mode") === "link" ? "link" : "login";
  const rememberMe = parseRememberMe(c.req.query("rememberMe"));
  const actor = c.get("user");

  if (mode === "link" && !actor) {
    return redirectToFrontendError(c, site, "oauth_link_login_required");
  }

  const csrf = randomBytes(16).toString("hex");
  const cookieValue = encodeStateCookie({
    csrf,
    site,
    returnTo,
    mode,
    rememberMe,
    linkUserId: mode === "link" ? actor?.id : undefined,
  });
  setCookie(c, STATE_COOKIE_NAME, cookieValue, {
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
  // provider state 는 CSRF token 만 — site/returnTo 는 state cookie 에서 복원.
  url.searchParams.set("state", csrf);
  if (provider === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }

  return c.redirect(url.toString(), 302);
});

/* -------------------------------------------------------------------------- */
/* DELETE /auth/oauth/:provider/link                                          */
/* -------------------------------------------------------------------------- */

oauthRoutes.delete("/:provider/link", requireAuth(), async (c) => {
  const provider = parseProvider(c.req.param("provider"));
  const user = c.get("user");

  const [localRows, oauthRows] = await Promise.all([
    db
      .select({ id: userLocalCredentials.id })
      .from(userLocalCredentials)
      .where(eq(userLocalCredentials.userId, user.id))
      .limit(1),
    db
      .select({
        id: userOauthAccounts.id,
        provider: userOauthAccounts.provider,
      })
      .from(userOauthAccounts)
      .where(eq(userOauthAccounts.userId, user.id)),
  ]);

  const target = oauthRows.find((row) => row.provider === provider);
  if (!target) {
    return c.json({ data: { ok: true, alreadyUnlinked: true } });
  }

  const hasLocal = localRows.length > 0;
  const remainingOauthCount = oauthRows.filter((row) => row.id !== target.id).length;
  if (!hasLocal && remainingOauthCount === 0) {
    throw AppError.badRequest(
      "마지막 로그인 수단은 해제할 수 없습니다.",
      "last_auth_method",
    );
  }

  await db.delete(userOauthAccounts).where(eq(userOauthAccounts.id, target.id));
  return c.json({ data: { ok: true } });
});

/* -------------------------------------------------------------------------- */
/* GET /auth/oauth/:provider/callback                                         */
/* -------------------------------------------------------------------------- */

oauthRoutes.get("/:provider/callback", async (c) => {
  let provider: OAuthProvider;
  try {
    provider = parseProvider(c.req.param("provider"));
  } catch {
    // provider 잘못된 경로 — 기본 site=newb 로 error redirect
    return redirectToFrontendError(c, "newb", "oauth_invalid_provider");
  }

  // state cookie 먼저 디코딩 (callback 후 error 시 redirect target 알기 위해)
  const cookieRaw = getCookie(c, STATE_COOKIE_NAME);
  const decoded = decodeStateCookie(cookieRaw);
  const site = decoded?.site ?? "newb";
  const returnTo = decoded?.returnTo ?? "/";
  const mode = decoded?.mode ?? "login";
  const rememberMe = decoded?.rememberMe ?? true;

  // state cookie 즉시 삭제 (1회용) — fail 이든 success 든 동일.
  deleteCookie(c, STATE_COOKIE_NAME, { domain: env.COOKIE_DOMAIN, path: "/auth" });

  const cfg = getProviderConfig(provider);
  if (!cfg) {
    return redirectToFrontendError(c, site, "oauth_not_configured");
  }

  const code = c.req.query("code");
  const stateParam = c.req.query("state");

  // provider 가 error= 로 돌려보내는 경우 (사용자가 동의 거부 등)
  const oauthErr = c.req.query("error");
  if (oauthErr) {
    logger.info({ oauthErr, provider, site }, "oauth provider returned error");
    return redirectToFrontendError(c, site, `oauth_provider_${oauthErr.slice(0, 32)}`);
  }

  if (!code) {
    return redirectToFrontendError(c, site, "oauth_code_missing");
  }
  if (!decoded || !stateParam || stateParam !== decoded.csrf) {
    return redirectToFrontendError(c, site, "oauth_state_mismatch");
  }

  try {
    const { access_token } = await exchangeCodeForToken(cfg, code);
    const userinfoRes = await fetch(cfg.userinfoUrl, {
      method: "GET",
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!userinfoRes.ok) {
      logger.warn({ status: userinfoRes.status, provider }, "oauth userinfo failed");
      return redirectToFrontendError(c, site, "oauth_userinfo_failed");
    }
    const raw = (await userinfoRes.json()) as Record<string, unknown>;
    const profile = normalizeProviderProfile(provider, raw);

    if (mode === "link") {
      if (!decoded?.linkUserId) {
        return redirectToFrontendPathError(c, site, returnTo, "oauth_link_state_missing");
      }
      const linkedUser = await linkOauthAccountToUser(decoded.linkUserId, provider, profile, raw);
      const tokens = await issueTokens(
        linkedUser.id,
        linkedUser.tokenVersion,
        {
          userAgent: c.req.header("user-agent") ?? undefined,
          ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
        },
        { rememberMe },
      );
      setAuthCookies(c, tokens);
      return c.redirect(buildRedirect(site, appendQuery(returnTo, { linked: provider })), 302);
    }

    const { user, isNew } = await upsertOauthUser(provider, profile, raw);
    if (user.status !== "active") {
      return redirectToFrontendError(c, site, "account_inactive");
    }

    const tokens = await issueTokens(
      user.id,
      user.tokenVersion,
      {
        userAgent: c.req.header("user-agent") ?? undefined,
        ipAddress: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
      },
      { rememberMe },
    );
    setAuthCookies(c, tokens);

    // 신규 OAuth 가입자 → /signup/setup (닉네임 등 설정).
    // 기존 사용자 → returnTo 또는 /.
    const targetPath = isNew ? "/signup/setup" : returnTo;
    return c.redirect(buildRedirect(site, targetPath), 302);
  } catch (err) {
    const code = err instanceof AppError ? err.code : "oauth_token_failed";
    logger.warn({ err, code, provider, site }, "oauth callback error");
    if (mode === "link" && decoded) {
      return redirectToFrontendPathError(c, site, returnTo, code ?? "oauth_token_failed");
    }
    return redirectToFrontendError(c, site, code ?? "oauth_token_failed");
  }
});

export default oauthRoutes;
