import { pgTable, uuid, text, timestamp, index, varchar } from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { posts } from "../posts/schema.js";

/**
 * 댓글. flat 구조 시작. 향후 대댓글 (parentId self-ref) 추가 가능.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    // 비회원 댓글 허용. null 이면 익명 + authorNickname/IP 로 식별.
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // 비회원 작성자 닉네임 (디시 스타일, default "ㅇㅇ"). authorId null 일 때만 의미.
    authorNickname: varchar("author_nickname", { length: 32 }),
    // 비회원 수정/삭제 권한 검증용. bcrypt 해시. null 이면 수정/삭제 불가.
    authorPasswordHash: varchar("author_password_hash", { length: 255 }),
    // 비회원 댓글 표시용 (예: "114.207"). authorId 가 null 일 때만.
    anonymousMarker: varchar("anonymous_marker", { length: 16 }),
    // 비회원 댓글 운영용 — 전체 IP / user agent hash. 어드민 view + IP 밴 검증.
    anonymousAuditHash: varchar("anonymous_audit_hash", { length: 128 }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    postIdx: index("comments_post_idx").on(t.postId, t.createdAt),
    authorIdx: index("comments_author_idx").on(t.authorId),
  }),
);

export type Comment = typeof comments.$inferSelect;
