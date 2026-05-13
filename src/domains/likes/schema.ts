import { pgTable, uuid, varchar, timestamp, unique, index } from "drizzle-orm/pg-core";
import { users } from "@/domains/auth/schema.js";

/**
 * 좋아요 — 다형(post / comment / contest_entry 등 무엇이든 target 가능).
 *   target_type / target_id 로 도메인 횡단. (user, target_type, target_id) unique.
 */
export const likes = pgTable(
  "likes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("target_type", { length: 32 }).notNull(), // "post" | "comment" | "contest_entry"
    targetId: uuid("target_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("likes_user_target_uniq").on(t.userId, t.targetType, t.targetId),
    targetIdx: index("likes_target_idx").on(t.targetType, t.targetId),
  }),
);

export type Like = typeof likes.$inferSelect;
