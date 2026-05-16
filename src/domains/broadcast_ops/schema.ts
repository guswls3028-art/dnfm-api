import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { SITE_CODES } from "../../shared/types/site.js";
import { users } from "../auth/schema.js";

/**
 * 방송 운영 도메인.
 *
 * hurock 은 팬 커뮤니티보다 "방송 중 운영실" 성격이 강하다. 질문 큐와
 * 추첨 기록은 게시판 글이 아니라 방송 회차의 운영 데이터로 보존한다.
 */
export const broadcastQuestionStatuses = [
  "received",
  "shortlisted",
  "on_air",
  "answered",
  "hidden",
  "rejected",
] as const;
export type BroadcastQuestionStatus = (typeof broadcastQuestionStatuses)[number];

export const broadcastQuestions = pgTable(
  "broadcast_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    nickname: varchar("nickname", { length: 32 }),
    category: varchar("category", { length: 40 }).notNull().default("general"),
    content: text("content").notNull(),
    imageR2Key: varchar("image_r2_key", { length: 512 }),
    status: varchar("status", { length: 16 })
      .notNull()
      .default("received")
      .$type<BroadcastQuestionStatus>(),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderationReason: text("moderation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => ({
    siteStatusIdx: index("broadcast_questions_site_status_idx").on(t.site, t.status, t.createdAt),
    userIdx: index("broadcast_questions_user_idx").on(t.userId, t.createdAt),
  }),
);

export const drawSessions = pgTable(
  "draw_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    title: varchar("title", { length: 160 }).notNull(),
    roundNumber: integer("round_number"),
    prize: varchar("prize", { length: 200 }),
    participants: jsonb("participants")
      .notNull()
      .default([] as string[])
      .$type<string[]>(),
    winners: jsonb("winners")
      .notNull()
      .default([] as string[])
      .$type<string[]>(),
    winnerCount: integer("winner_count").notNull().default(1),
    executedBy: uuid("executed_by").references(() => users.id, { onDelete: "set null" }),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteExecutedIdx: index("draw_sessions_site_executed_idx").on(t.site, t.executedAt),
    siteRoundIdx: index("draw_sessions_site_round_idx").on(t.site, t.roundNumber),
  }),
);

export type BroadcastQuestion = typeof broadcastQuestions.$inferSelect;
export type DrawSession = typeof drawSessions.$inferSelect;
