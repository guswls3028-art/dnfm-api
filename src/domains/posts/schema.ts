import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { users } from "../auth/schema.js";
import { SITE_CODES } from "../../shared/types/site.js";

/**
 * 게시판 — 디시 던모갤 구조를 reference 로 (구조만 빌림, 톤은 자체).
 *
 * 계층:
 *   site (newb / allow)
 *     └── post_categories (큰 분류 — 자유 / 질문 / 공지 등. 사이트별 정의)
 *           └── posts
 *                 └── flair      (말머리 — 카테고리 안의 글 자체 분류. 단일)
 *                 └── post_type  (normal / notice / best / poll)
 *                 └── anonymous  (익명 글 — IP 끝자리 4자리만 marker 로 노출)
 *                 └── 추천/비추천 (별도 post_votes 테이블, Stage 3)
 *                 └── 댓글       ([[domains/comments]])
 *                 └── 댓글/추천 카운터 (denormalized)
 *
 * BEST 글은 추천수 임계치 넘으면 자동 승격. 어드민이 수기 지정도 가능.
 * (디시의 "개념글" 에 해당 — 용어만 BEST 로 통일)
 *
 * 익명 정책:
 *   - 비회원 글 허용은 사이트별 정책. 회원만 vs 익명 허용 (IP 끝자리 노출).
 *   - 익명이라도 IP 일부 + user_agent fingerprint 는 운영자만 볼 수 있게 audit.
 *   - 자세한 결정은 사용자 정책에 따라 운영 단계에서.
 */
export const postCategories = pgTable(
  "post_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    // 글쓰기 허용 권한 최소치: "anonymous" | "member" | "admin"
    writeRoleMin: varchar("write_role_min", { length: 16 }).notNull().default("member"),
    // 익명 허용 여부 (writeRoleMin = anonymous 일 때만 의미)
    allowAnonymous: boolean("allow_anonymous").notNull().default(false),
    // 카테고리별 말머리 enum (JSON array). 예: ["일반","자랑","정보","질문","쿠폰","버그제보","창작"]
    flairs: text("flairs").array().notNull().default([] as string[]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    siteSlugUniq: unique("post_categories_site_slug_uniq").on(t.site, t.slug),
  }),
);

export const postTypes = ["normal", "notice", "best", "poll", "ad"] as const;
export type PostType = (typeof postTypes)[number];

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    site: varchar("site", { length: 16 }).notNull().$type<(typeof SITE_CODES)[number]>(),
    categoryId: uuid("category_id").references(() => postCategories.id, { onDelete: "set null" }),
    // null 이면 익명 글. anonymousMarker 로 작성자 구분.
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // 익명 글 표시용 (예: "114.207" — IP 의 일부). authorId 가 null 일 때만.
    anonymousMarker: varchar("anonymous_marker", { length: 16 }),
    // 익명 글 운영용 — 전체 IP / user agent hash. 어드민 view 만.
    anonymousAuditHash: varchar("anonymous_audit_hash", { length: 128 }),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body").notNull(),
    bodyFormat: varchar("body_format", { length: 16 }).notNull().default("markdown"),
    flair: varchar("flair", { length: 32 }), // 말머리 (카테고리의 flairs 중 하나)
    postType: varchar("post_type", { length: 16 }).notNull().default("normal").$type<PostType>(),
    attachmentR2Keys: text("attachment_r2_keys").array().notNull().default([] as string[]),
    pinned: boolean("pinned").notNull().default(false),
    locked: boolean("locked").notNull().default(false),
    viewCount: integer("view_count").notNull().default(0),
    // denormalized — 정확도는 service 가 보장 (글 작성/삭제 시 갱신)
    commentCount: integer("comment_count").notNull().default(0),
    recommendCount: integer("recommend_count").notNull().default(0),
    downvoteCount: integer("downvote_count").notNull().default(0),
    // BEST 승격 시각. 자동(threshold) or 수기(어드민).
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    siteCategoryIdx: index("posts_site_category_idx").on(t.site, t.categoryId, t.createdAt),
    siteAuthorIdx: index("posts_site_author_idx").on(t.site, t.authorId),
    siteCreatedIdx: index("posts_site_created_idx").on(t.site, t.createdAt),
    sitePinnedIdx: index("posts_site_pinned_idx").on(t.site, t.pinned, t.createdAt),
    sitePostTypeIdx: index("posts_site_post_type_idx").on(t.site, t.postType, t.createdAt),
  }),
);

/**
 * post_votes — 디시 추천/비추천. 한 user 가 한 post 에 1표.
 * (post_id, voter_id) unique. 익명 vote 는 anonymousMarker 기반으로 별도 처리 가능 (다음 cycle).
 */
export const postVoteTypes = ["recommend", "downvote"] as const;
export type PostVoteType = (typeof postVoteTypes)[number];

export const postVotes = pgTable(
  "post_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    voterId: uuid("voter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    voteType: varchar("vote_type", { length: 16 }).notNull().$type<PostVoteType>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    voterUniq: unique("post_votes_post_voter_uniq").on(t.postId, t.voterId),
    postTypeIdx: index("post_votes_post_type_idx").on(t.postId, t.voteType),
  }),
);

export type Post = typeof posts.$inferSelect;
export type PostCategory = typeof postCategories.$inferSelect;
export type PostVote = typeof postVotes.$inferSelect;
