import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  unique,
  integer,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/**
 * users — 플랫폼 통합 계정.
 *   - 두 사이트 (newb / allow) 가 같은 회원 풀을 공유.
 *   - 사이트별 역할은 [[site_membership.schema]] 의 user_site_roles 에서.
 *   - 인증 방식 (local / google / kakao) 은 각각 별도 테이블 (1:N).
 *
 * dnf_profile — 사용자가 입력하는 던파 모바일 게임 정보.
 *   회원가입 시 선택 입력. 콘테스트 참가 시 모험단명/캐릭터명 prefill 에 사용.
 *   세부 schema 는 자유로운 JSON — 운영자가 추후 필드 추가하기 쉽게.
 *   예: { adventurer: { name, level, server }, mains: [{name, class, power}, ...] }
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // display 용 표시명. 공백 허용 (예: "방장쿤"). 변경 가능.
    displayName: varchar("display_name", { length: 32 }).notNull(),
    // 회원 가입 시 발급되는 primary email. local 가입 시 username 으로도 사용 가능.
    // OAuth 로 가입한 경우 provider email 이 들어옴. NULL 허용 (kakao 등 email 없는 경우).
    email: varchar("email", { length: 255 }),
    // 프로필 사진 (R2 key)
    avatarR2Key: varchar("avatar_r2_key", { length: 512 }),
    // 던파 모바일 자유 프로필 JSON
    dnfProfile: jsonb("dnf_profile").$type<DnfProfile>(),
    // 비활성화 / 정지 / 삭제 플래그
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | suspended | deleted
    // 비번 변경, 강제 logout 등을 위한 token version
    tokenVersion: integer("token_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index("users_email_idx").on(t.email),
  }),
);

/**
 * users.dnf_profile JSON shape — 사용자가 던파 모바일 캡처 업로드하면
 * OCR 이 다음 3종만 인식해 자동 채움. 항마력 / 레벨 / 서버는 인식 X
 * (가변·노이즈가 큰 정보라 매번 갱신 부담만 늘림).
 *
 * 사용자는 OCR 결과를 본 뒤 수기 보정 가능. confirmed 표시는 검증 완료.
 *
 * 콘테스트 참가 시 모험단명·캐릭터(이름+직업) prefill 에 그대로 사용.
 */
export interface DnfProfile {
  adventurerName?: string; // 모험단명 (예: "광기의 파도")
  characters?: Array<{
    name: string; // 캐릭터명 (예: "지금간다")
    klass: string; // 직업 (예: "오버마인드") — class 는 JS 예약어라 klass
  }>;
  // 본인 인증 — 2번(보유캐릭터) ∩ 3번(캐릭터 선택창) overlap 통과 여부.
  // 3번은 게임 로그인 직후만 볼 수 있어 도용 어려움.
  verifiedBySelectScreen?: boolean;
  // 업로드한 원본 캡처 R2 keys (검증·재인식 / dispute 시 참조).
  captureR2Keys?: {
    basicInfo?: string;
    characterList?: string;
    characterSelect?: string;
  };
  confirmedAt?: string; // ISO — 사용자가 OCR 결과 보고 확정한 시각
}

/**
 * user_local_credentials — 자체 로그인 (아이디 + 비번) 자격증명.
 *   - username 은 사용자 지정 (영문/숫자/언더스코어). email 과 별개.
 *   - 비번은 bcrypt hash 만 저장. 평문 절대 X.
 *   - 한 user 는 local credentials 0개 또는 1개 (OAuth 만 쓰면 0개).
 */
export const userLocalCredentials = pgTable(
  "user_local_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .unique(),
    username: varchar("username", { length: 32 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    passwordUpdatedAt: timestamp("password_updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    usernameIdx: index("user_local_credentials_username_idx").on(t.username),
  }),
);

/**
 * user_oauth_accounts — Google / Kakao 등 OAuth provider 연동.
 *   - 한 user 가 여러 provider 동시 link 가능 (예: 자체 + google + kakao).
 *   - (provider, providerUserId) 는 unique — 한 외부계정은 한 user 에만 link.
 */
export const oauthProviders = ["google", "kakao"] as const;
export type OAuthProvider = (typeof oauthProviders)[number];

export const userOauthAccounts = pgTable(
  "user_oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 16 }).notNull().$type<OAuthProvider>(),
    providerUserId: varchar("provider_user_id", { length: 128 }).notNull(),
    providerEmail: varchar("provider_email", { length: 255 }),
    // 마지막 OAuth login 시 받은 raw profile (debug / future fields)
    providerProfile: jsonb("provider_profile"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => ({
    providerUserUniq: unique("user_oauth_provider_user_uniq").on(t.provider, t.providerUserId),
    userProviderIdx: index("user_oauth_user_provider_idx").on(t.userId, t.provider),
  }),
);

/**
 * refresh_tokens — JWT refresh rotation.
 *   - access token 은 stateless (JWT). refresh 만 DB 추적.
 *   - 회원 logout / 비번 변경 시 해당 user 의 모든 refresh 무효 (또는 token_version 증가).
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // hash 한 token (raw token 은 cookie 에만, DB 에는 SHA256). rotation 시 비교용.
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    // 발급 시점에 user.token_version snapshot (revoke 검사용).
    tokenVersion: integer("token_version").notNull(),
    // 디바이스/세션 추적 메타.
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 64 }),
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index("refresh_tokens_user_idx").on(t.userId, t.revoked),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserLocalCredential = typeof userLocalCredentials.$inferSelect;
export type UserOauthAccount = typeof userOauthAccounts.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
