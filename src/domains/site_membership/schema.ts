import { pgTable, uuid, varchar, timestamp, unique, index } from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { SITE_CODES, SITE_ROLES } from "../../shared/types/site.js";

/**
 * user_site_roles — 사이트별 권한.
 * 같은 user 가 newb 에서 admin, allow 에서 member 일 수 있음.
 * super 는 한 row 로 모든 사이트 권한 우회 (site = "*"). 별도 처리.
 *
 * (user_id, site) unique — 한 사용자는 사이트당 1 row.
 */
export const userSiteRoles = pgTable(
  "user_site_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number] | "*">(),
    role: varchar("role", { length: 16 }).notNull().$type<(typeof SITE_ROLES)[number]>(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid("granted_by").references(() => users.id),
  },
  (t) => ({
    userSiteUniq: unique("user_site_roles_user_site_uniq").on(t.userId, t.site),
    siteIdx: index("user_site_roles_site_idx").on(t.site, t.role),
  }),
);

export type UserSiteRole = typeof userSiteRoles.$inferSelect;
