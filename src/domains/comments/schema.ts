import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
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
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
