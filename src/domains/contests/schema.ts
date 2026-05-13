import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { SITE_CODES } from "../../shared/types/site.js";

/**
 * 콘테스트 ([[allow]] 핵심 기능, [[newb]] 도 향후 활용 가능).
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
 *   draft → open → judging → voting → completed
 *   - draft     어드민 작성 중
 *   - open      참가 글 받음
 *   - judging   마감 후 어드민 후보 선정 중
 *   - voting    투표 기간
 *   - completed 결과 발표 끝
 */
export const contestStatuses = ["draft", "open", "judging", "voting", "completed"] as const;
export type ContestStatus = (typeof contestStatuses)[number];

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
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    contestIdx: index("contest_entries_contest_idx").on(t.contestId, t.createdAt),
    authorIdx: index("contest_entries_author_idx").on(t.authorId),
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
    note: text("note"), // 어드민 코멘트
    announcedAt: timestamp("announced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contestRankUniq: unique("contest_results_contest_rank_uniq").on(t.contestId, t.rank),
  }),
);

export type Contest = typeof contests.$inferSelect;
export type ContestEntry = typeof contestEntries.$inferSelect;
export type ContestVote = typeof contestVotes.$inferSelect;
export type ContestResult = typeof contestResults.$inferSelect;
