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

export async function issueTokens(
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

/** username 중복 여부 — true 면 사용 가능. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const rows = await db
    .select({ id: userLocalCredentials.id })
    .from(userLocalCredentials)
    .where(eq(userLocalCredentials.username, username))
    .limit(1);
  return rows.length === 0;
}

/** displayName(닉네임) 중복 여부 — true 면 사용 가능. */
export async function isDisplayNameAvailable(displayName: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.displayName, displayName))
    .limit(1);
  return rows.length === 0;
}

/** 자체 가입 — username + displayName 중복 검사 → users + user_local_credentials insert → 자동 로그인. */
export async function localSignup(
  input: LocalSignupInput,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthResult> {
  const passwordCheck = validatePasswordPolicy(input.password);
  if (!passwordCheck.ok) {
    throw AppError.unprocessable(passwordCheck.reason, "weak_password");
  }

  const existingUsername = await db
    .select({ id: userLocalCredentials.id })
    .from(userLocalCredentials)
    .where(eq(userLocalCredentials.username, input.username))
    .limit(1);
  if (existingUsername.length > 0) {
    throw AppError.conflict("이미 사용 중인 아이디입니다.", "username_taken");
  }

  const existingDisplayName = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.displayName, input.displayName))
    .limit(1);
  if (existingDisplayName.length > 0) {
    throw AppError.conflict("이미 사용 중인 닉네임입니다.", "display_name_taken");
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

/**
 * Refresh token rotation.
 *
 * 1) 들어온 raw token 으로 JWT verify (만료/시그니처)
 * 2) tokenHash 로 DB row 조회 → 미존재 / revoked / expired 면 401
 * 3) user.token_version 과 row.token_version 일치 검사 (비번 변경 등으로 bump 됐으면 reject)
 * 4) 기존 row revoke + 새 토큰 발급 (rotation)
 *
 * 정책:
 *   - reuse 감지 (revoked row 에 다시 들어오면) → 의심스러우니 그 user 의 token_version bump 해서 전 디바이스 로그아웃
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<AuthResult> {
  // 1) JWT verify
  let payload: { sub: string; jti: string };
  try {
    const { verifyRefreshToken } = await import("@/shared/crypto/jwt.js");
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "refresh_invalid");
  }

  const tokenHash = sha256(rawRefreshToken);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "refresh_missing");
  }

  // 2) reuse detect — 이미 revoked 상태로 들어오면 도용 의심
  if (row.revoked) {
    await db.update(users).set({ tokenVersion: row.tokenVersion + 1 }).where(eq(users.id, row.userId));
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "refresh_reused");
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "refresh_expired");
  }

  // 3) user 검증
  const userRows = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
  const user = userRows[0];
  if (!user || user.status !== "active") {
    throw AppError.unauthorized("계정을 사용할 수 없습니다.", "account_inactive");
  }
  if (user.tokenVersion !== row.tokenVersion) {
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "token_version_mismatch");
  }
  if (user.id !== payload.sub) {
    throw AppError.unauthorized("세션이 만료됐습니다. 다시 로그인해 주세요.", "refresh_subject_mismatch");
  }

  // 4) rotate — 기존 revoke + 새 발급
  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(eq(refreshTokens.id, row.id));

  const tokens = await issueTokens(user.id, user.tokenVersion, meta);
  return { user, tokens };
}

/** 프로필 수정 — displayName/email/avatar/dnfProfile. displayName 중복 검사. */
export async function updateUserProfile(
  userId: string,
  input: {
    displayName?: string;
    email?: string | null;
    avatarR2Key?: string | null;
    dnfProfile?: User["dnfProfile"];
  },
): Promise<User> {
  if (input.displayName !== undefined) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.displayName, input.displayName))
      .limit(1);
    const taken = existing[0];
    if (taken && taken.id !== userId) {
      throw AppError.conflict("이미 사용 중인 닉네임입니다.", "display_name_taken");
    }
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.email !== undefined) patch.email = input.email;
  if (input.avatarR2Key !== undefined) patch.avatarR2Key = input.avatarR2Key;
  if (input.dnfProfile !== undefined) patch.dnfProfile = input.dnfProfile;

  const updated = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  const user = updated[0];
  if (!user) throw AppError.notFound("계정을 찾을 수 없습니다.", "user_not_found");
  return user;
}

/**
 * 비밀번호 변경 — 현재 비번 확인 → 새 비번 정책 검사 → hash 교체 + tokenVersion bump
 * (모든 기존 세션 무효화).
 */
export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const credRows = await db
    .select()
    .from(userLocalCredentials)
    .where(eq(userLocalCredentials.userId, userId))
    .limit(1);
  const cred = credRows[0];
  if (!cred) {
    throw AppError.badRequest("자체 로그인 자격증명이 없습니다.", "no_local_credentials");
  }

  const ok = await verifyPassword(input.currentPassword, cred.passwordHash);
  if (!ok) {
    throw AppError.unauthorized("현재 비밀번호가 올바르지 않습니다.", "invalid_current_password");
  }

  const policy = validatePasswordPolicy(input.newPassword);
  if (!policy.ok) {
    throw AppError.unprocessable(policy.reason, "weak_password");
  }

  const newHash = await hashPassword(input.newPassword);
  await db
    .update(userLocalCredentials)
    .set({ passwordHash: newHash, passwordUpdatedAt: new Date() })
    .where(eq(userLocalCredentials.id, cred.id));

  // 전 세션 무효화 — tokenVersion bump
  const userRow = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const currentVersion = userRow[0]?.tokenVersion ?? 0;
  await db.update(users).set({ tokenVersion: currentVersion + 1 }).where(eq(users.id, userId));

  // 기존 refresh token 모두 revoke
  await db
    .update(refreshTokens)
    .set({ revoked: true, revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.revoked, false)));
}
