import { pgTable, uuid, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "@/domains/auth/schema.js";

/**
 * R2 업로드 메타데이터.
 *   - 백엔드가 presigned PUT 발급 시 row 미리 생성 (status=pending).
 *   - 클라가 upload 완료 후 confirm 콜 → status=ready.
 *   - 사용자 게시물/콘테스트/프로필 등에서 r2_key 참조.
 *
 * R2 자체는 키 = id 와 동일하게 사용 (충돌 방지). 또는 site/scope prefix.
 */
export const uploadStatuses = ["pending", "ready", "deleted"] as const;
export type UploadStatus = (typeof uploadStatuses)[number];

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    r2Key: varchar("r2_key", { length: 512 }).notNull().unique(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes"),
    status: varchar("status", { length: 16 })
      .notNull()
      .default("pending")
      .$type<UploadStatus>(),
    // 업로드 목적 — "avatar" | "dnf_capture" | "contest_entry" | "post_attachment" 등
    purpose: varchar("purpose", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => ({
    ownerIdx: index("uploads_owner_idx").on(t.ownerId, t.createdAt),
    purposeIdx: index("uploads_purpose_idx").on(t.purpose, t.status),
  }),
);

export type Upload = typeof uploads.$inferSelect;
