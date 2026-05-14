import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { SITE_CODES } from "../../shared/types/site.js";

/**
 * 신고 — post / comment 대상.
 *
 * site 격리:
 *   - 모든 신고는 site 컬럼 보유. cross-site 신고 불가.
 *   - target_type / target_id 로 다형 참조 (FK 강제는 X — soft 참조).
 *     soft delete 대상도 신고 가능해야 분쟁 기록 보존.
 *
 * 비회원 신고:
 *   - reporter_id null + anonymous_audit_hash 로 fingerprint.
 *   - 중복 신고 방지 unique = (site, target_type, target_id, reporter_id 또는 hash).
 *     reporter_id 가 있으면 그걸로, 없으면 anonymous_audit_hash 로.
 *
 * 처리 상태:
 *   pending    — 접수
 *   in_review  — 운영자 검토 중
 *   resolved   — 처리 완료 (조치 후)
 *   dismissed  — 기각
 *
 * audit:
 *   - resolution / resolution_note / resolved_by / resolved_at
 *   - moderator memo (사용자 비공개)
 */
export const reportTargetTypes = ["post", "comment"] as const;
export type ReportTargetType = (typeof reportTargetTypes)[number];

export const reportReasons = [
  "spam",
  "abuse",
  "porn",
  "hate",
  "privacy",
  "copyright",
  "advertise",
  "malicious_link",
  "other",
] as const;
export type ReportReason = (typeof reportReasons)[number];

export const reportStatuses = ["pending", "in_review", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof reportStatuses)[number];

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    targetType: varchar("target_type", { length: 16 }).notNull().$type<ReportTargetType>(),
    targetId: uuid("target_id").notNull(),
    reporterId: uuid("reporter_id").references(() => users.id, { onDelete: "set null" }),
    // 비회원 fingerprint — reporter_id null 일 때 dedup 키.
    anonymousAuditHash: varchar("anonymous_audit_hash", { length: 128 }),
    reason: varchar("reason", { length: 32 }).notNull().$type<ReportReason>(),
    detail: text("detail"),
    status: varchar("status", { length: 16 }).notNull().default("pending").$type<ReportStatus>(),
    // 처리 결과
    resolution: varchar("resolution", { length: 32 }), // e.g. "hidden", "deleted", "warned_user", "ip_banned", "dismissed"
    resolutionNote: text("resolution_note"),
    moderatorMemo: text("moderator_memo"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteTargetIdx: index("reports_site_target_idx").on(t.site, t.targetType, t.targetId),
    siteStatusIdx: index("reports_site_status_idx").on(t.site, t.status, t.createdAt),
    // 중복 신고 방지 — 회원: (site, target_type, target_id, reporter_id) unique.
    // 비회원은 anonymous_audit_hash 로 dedup (다른 unique index 로 처리하기엔
    // null reporter_id 충돌 회피 어려움 — 일단 회원만 hard unique, 비회원은
    // service 레이어에서 검사).
    reporterUniq: unique("reports_target_reporter_uniq").on(
      t.site,
      t.targetType,
      t.targetId,
      t.reporterId,
    ),
  }),
);

export type Report = typeof reports.$inferSelect;
