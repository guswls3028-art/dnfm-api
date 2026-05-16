import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { SITE_CODES } from "../../shared/types/site.js";
import { users } from "../auth/schema.js";

/**
 * 콘테스트 ([[hurock]] 핵심 기능, [[newb]] 도 향후 활용 가능).
 *
 *   contests          어드민이 생성. 마감/투표 기간 시스템 시계 기준.
 *   contest_entries   회원이 참가 글 + 사진 등록. 마감 후엔 새 entry 거부.
 *   contest_votes     투표 기간에 1회원 1표. (contest, voter) unique.
 *   contest_results   어드민이 발표하는 최종 결과 (자동 산정 보조 + 수기 보정).
 *
 *   form_schema       어드민이 콘테스트마다 자유롭게 정의하는 참가 양식 JSON.
 *                     (예: {fields: [{name:"adventurer_name", required:true, prefill:"dnf"}, ...]})
 *   entry_fields      entry 가 form_schema 에 따라 채운 값.
 *
 * 상태 라이프사이클:
 *   draft → open → closed → judging → voting → results → archived
 *   - draft      어드민 작성 중
 *   - open       참가 글 받음
 *   - closed     접수 마감, 공개 전 검수 가능
 *   - judging    마감 후 어드민 후보 선정/심사 중
 *   - voting     투표 기간
 *   - results    결과 발표 끝
 *   - archived   읽기 전용 보관
 *   - cancelled  취소됨
 */
export const contestStatuses = [
  "draft",
  "open",
  "closed",
  "voting",
  "judging",
  "results",
  "archived",
  "cancelled",
] as const;
export type ContestStatus = (typeof contestStatuses)[number];

export const contestEntryStatuses = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "hidden",
  "winner",
  "disqualified",
] as const;
export type ContestEntryStatus = (typeof contestEntryStatuses)[number];

export const contests = pgTable(
  "contests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 16 }).notNull().default("draft").$type<ContestStatus>(),
    // 참가 양식 (form_schema) — 어드민이 사이트별로 자유 정의
    formSchema: jsonb("form_schema")
      .notNull()
      .default({} as Record<string, unknown>),
    // 참가 최대 개수 (0 = 무제한)
    maxEntries: integer("max_entries").notNull().default(0),
    // 마감 / 투표 기간 (UTC)
    entryDeadlineAt: timestamp("entry_deadline_at", { withTimezone: true }),
    voteStartAt: timestamp("vote_start_at", { withTimezone: true }),
    voteEndAt: timestamp("vote_end_at", { withTimezone: true }),
    // 콘테스트 대표 이미지 (R2)
    coverR2Key: varchar("cover_r2_key", { length: 512 }),
    /**
     * 자유 metadata (jsonb).
     *   - 어드민이 콘테스트 진행에 필요한 부가 정보를 자유롭게 박는 자리.
     *   - 예: posterEmoji / eventAt / submissionCloses / voteWindow / resultsAt /
     *     prizePool / categories[] / rules[] / rewards[] / judging{summary, bullets[]}
     *   - frontend 가 detail 페이지에서 동일 키로 읽어 표시.
     *   - schema 확장하지 않고 자유 진화 — 후속에 별도 컬럼화 필요 시 migration 추가.
     */
    metadata: jsonb("metadata")
      .notNull()
      .default({} as Record<string, unknown>),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteStatusIdx: index("contests_site_status_idx").on(t.site, t.status),
  }),
);

export const contestEntries = pgTable(
  "contest_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    // null 이면 비회원 entry. anonymousMarker / authorNickname 으로 표시.
    // 정책 SSOT: ~/.claude/projects/.../memory/project_anonymous_posting_policy.md (2026-05-14)
    authorId: uuid("author_id").references(() => users.id, { onDelete: "cascade" }),
    // 비회원 작성자 닉네임 (디시 스타일, default "ㅇㅇ"). authorId null 일 때만.
    authorNickname: varchar("author_nickname", { length: 32 }),
    // 비회원 수정/삭제 권한 검증용. bcrypt 해시. null 이면 비번 없음 = 수정/삭제 불가.
    authorPasswordHash: varchar("author_password_hash", { length: 255 }),
    // 비회원 표시용 (예: "114.207"). authorId null 일 때만.
    anonymousMarker: varchar("anonymous_marker", { length: 16 }),
    // 어드민 audit + IP밴 검증용. 전체 IP + UA sha-256.
    anonymousAuditHash: varchar("anonymous_audit_hash", { length: 128 }),
    // form_schema 에 맞춘 자유 양식 응답 (모험단명/캐릭터명/코디 제목/설명 등)
    fields: jsonb("fields").notNull(),
    // 업로드한 사진 R2 keys (여러 장 가능)
    imageR2Keys: text("image_r2_keys")
      .array()
      .notNull()
      .default([] as string[]),
    // 어드민이 후보로 선정했는지
    selectedForVote: boolean("selected_for_vote").notNull().default(false),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    // 참가작 검수 상태. 공개 목록에는 approved/winner 만 노출한다.
    status: varchar("status", { length: 16 })
      .notNull()
      .default("submitted")
      .$type<ContestEntryStatus>(),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    contestIdx: index("contest_entries_contest_idx").on(t.contestId, t.createdAt),
    authorIdx: index("contest_entries_author_idx").on(t.authorId),
    contestStatusIdx: index("contest_entries_contest_status_idx").on(t.contestId, t.status),
  }),
);

export const contestVotes = pgTable(
  "contest_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    voterId: uuid("voter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => contestEntries.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    voterUniq: unique("contest_votes_voter_uniq").on(t.contestId, t.voterId), // 1회원 1표
    entryIdx: index("contest_votes_entry_idx").on(t.entryId),
  }),
);

export const contestResults = pgTable(
  "contest_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => contestEntries.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    awardName: varchar("award_name", { length: 80 }),
    note: text("note"), // 어드민 코멘트
    reason: text("reason"), // 수상자 지정/변경 사유
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contestRankUniq: unique("contest_results_contest_rank_uniq").on(t.contestId, t.rank),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    actorId: uuid("actor_id").references(() => users.id),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: varchar("target_id", { length: 128 }).notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteTargetIdx: index("audit_logs_site_target_idx").on(t.site, t.targetType, t.targetId),
    actorIdx: index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
  }),
);

export type Contest = typeof contests.$inferSelect;
export type ContestEntry = typeof contestEntries.$inferSelect;
export type ContestVote = typeof contestVotes.$inferSelect;
export type ContestResult = typeof contestResults.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
