import { eq, and } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/shared/db/client.js";
import { users, userLocalCredentials, refreshTokens, type User } from "./schema.js";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "@/shared/crypto/password.js";
import { signAccessToken, signRefreshToken } from "@/shared/crypto/jwt.js";
import { env } from "@/config/env.js";
import { AppError } from "@/shared/errors/app-error.js";
import type { LocalSignupInput, LocalLoginInput } from "./dto.js";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function issueTokens(
  userId: string,
  tokenVersion: number,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthTokens> {
  const refreshRow = randomBytes(32).toString("hex"); // raw random — JWT 의 jti 로 사용
  const refreshToken = signRefreshToken(userId, refreshRow);
  const accessToken = signAccessToken(userId);

  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + env.JWT_ACCESS_TTL_SECONDS * 1000);
  const refreshExpiresAt = new Date(now.getTime() + env.JWT_REFRESH_TTL_SECONDS * 1000);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash: sha256(refreshToken),
    tokenVersion,
    userAgent: meta.userAgent?.slice(0, 1024),
    ipAddress: meta.ipAddress?.slice(0, 64),
    expiresAt: refreshExpiresAt,
  });

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
}

/** 자체 가입 — username 중복 검사 → users + user_local_credentials insert → 자동 로그인. */
export async function localSignup(
  input: LocalSignupInput,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthResult> {
  const passwordCheck = validatePasswordPolicy(input.password);
  if (!passwordCheck.ok) {
    throw AppError.unprocessable(passwordCheck.reason, "weak_password");
  }

  const existing = await db
    .select({ id: userLocalCredentials.id })
    .from(userLocalCredentials)
    .where(eq(userLocalCredentials.username, input.username))
    .limit(1);
  if (existing.length > 0) {
    throw AppError.conflict("이미 사용 중인 아이디입니다.", "username_taken");
  }

  const passwordHash = await hashPassword(input.password);

  const inserted = await db
    .insert(users)
    .values({
      displayName: input.displayName,
      email: input.email,
      dnfProfile: input.dnfProfile,
    })
    .returning();
  const user = inserted[0];
  if (!user) throw AppError.internal("user insert failed");

  await db.insert(userLocalCredentials).values({
    userId: user.id,
    username: input.username,
    passwordHash,
  });

  const tokens = await issueTokens(user.id, user.tokenVersion, meta);
  return { user, tokens };
}

/** 자체 로그인 — username 으로 credentials 조회 → bcrypt 검증 → 토큰 발급. */
export async function localLogin(
  input: LocalLoginInput,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthResult> {
  const cred = await db
    .select()
    .from(userLocalCredentials)
    .where(eq(userLocalCredentials.username, input.username))
    .limit(1);
  const row = cred[0];
  if (!row) {
    throw AppError.unauthorized("아이디 또는 비밀번호가 올바르지 않습니다.", "invalid_credentials");
  }

  const ok = await verifyPassword(input.password, row.passwordHash);
  if (!ok) {
    throw AppError.unauthorized("아이디 또는 비밀번호가 올바르지 않습니다.", "invalid_credentials");
  }

  const userRows = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  const user = userRows[0];
  if (!user) throw AppError.internal("user missing for credentials");
  if (user.status !== "active") {
    throw AppError.forbidden("계정이 비활성화 상태입니다.", "account_inactive");
  }

  const tokens = await issueTokens(user.id, user.tokenVersion, meta);
  return { user, tokens };
}

/** 로그아웃 — 해당 refresh token 무효화. access 는 짧은 TTL 이라 자연 만료 대기. */
export async function logoutByRefresh(refreshToken: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, sha256(refreshToken)), eq(refreshTokens.revoked, false)));
}
