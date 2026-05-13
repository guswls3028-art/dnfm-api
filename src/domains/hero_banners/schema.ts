import { pgTable, uuid, varchar, text, timestamp, boolean, integer, index } from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { SITE_CODES } from "../../shared/types/site.js";

/**
 * 사이트 hero 영역 admin banner.
 *
 * 방장이 추가 banner 카드를 hero 에 노출. 이미지 URL + 클릭 시 이동 URL.
 * 운영자(admin/super)만 CRUD. 공개 GET 은 active=true 만 노출.
 */
export const heroBanners = pgTable(
  "hero_banners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    imageUrl: text("image_url").notNull(),
    linkUrl: text("link_url"),
    label: varchar("label", { length: 80 }),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteActiveIdx: index("hero_banners_site_active_idx").on(t.site, t.active, t.sortOrder),
  }),
);
