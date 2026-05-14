import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";
import { postTypes, postVoteTypes } from "./schema.js";

/** 카테고리 생성 (어드민). */
export const createCategoryDto = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).optional(),
  sortOrder: z.number().int().default(0),
  writeRoleMin: z.enum(["anonymous", "member", "admin"]).default("member"),
  allowAnonymous: z.boolean().default(false),
  flairs: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
});
export type CreateCategoryInput = z.infer<typeof createCategoryDto>;

/** 글 생성. 회원이면 인증으로, 비회원이면 guest 필드로. */
export const createPostDto = z.object({
  categoryId: z.string().uuid().optional(),
  // categoryId 대체 — slug 도 허용. 둘 다 오면 categoryId 우선.
  categorySlug: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  bodyFormat: z.enum(["markdown", "html", "plain"]).default("markdown"),
  flair: z.string().trim().max(32).optional(),
  postType: z.enum(postTypes).optional(), // 보통 normal. notice/ad 는 admin only.
  attachmentR2Keys: z.array(z.string().max(512)).max(20).default([]),
  // 비회원 작성용 (디시 스타일). 회원 인증 있으면 무시.
  guestNickname: z.string().trim().min(1).max(32).optional(),
  guestPassword: z.string().min(4).max(128).optional(),
});
export type CreatePostInput = z.infer<typeof createPostDto>;

/** 글 수정. 비회원이면 guestPassword 로 본인 검증. */
export const updatePostDto = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(50_000).optional(),
  bodyFormat: z.enum(["markdown", "html", "plain"]).optional(),
  flair: z.string().trim().max(32).optional().nullable(),
  pinned: z.boolean().optional(), // admin only
  locked: z.boolean().optional(), // admin only
  attachmentR2Keys: z.array(z.string().max(512)).max(20).optional(),
  guestPassword: z.string().min(1).max(128).optional(), // 비회원 본인 검증용
});
export type UpdatePostInput = z.infer<typeof updatePostDto>;

/** 글 삭제 (비회원 본인 검증용). */
export const deletePostDto = z.object({
  guestPassword: z.string().min(1).max(128).optional(),
});
export type DeletePostInput = z.infer<typeof deletePostDto>;

/** 글 list 쿼리. */
export const listPostsQuery = z.object({
  categoryId: z.string().uuid().optional(),
  // categoryId 의 대체 — slug 로도 필터 가능. frontend 가 mock 카테고리에서 동적 fetch
  // 로 전환되는 동안 호환. 둘 다 오면 categoryId 우선.
  categorySlug: z
    .string()
    .trim()
    .max(64)
    .regex(/^[a-z0-9_-]+$/)
    .optional(),
  /**
   * 작성자 필터.
   *   "me" — 현재 로그인 유저 본인 글만. 비로그인 시 빈 결과.
   *   UUID — 특정 user 의 글 (공개 프로필 페이지용).
   */
  author: z.union([z.literal("me"), z.string().uuid()]).optional(),
  flair: z.string().trim().max(32).optional(),
  postType: z.enum(postTypes).optional(),
  bestOnly: z
    .string()
    .transform((v) => v === "true")
    .pipe(z.boolean())
    .optional(),
  q: z.string().trim().max(100).optional(), // 검색어 (제목+내용)
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(["recent", "best", "views"]).default("recent"),
});
export type ListPostsQuery = z.infer<typeof listPostsQuery>;

/** 투표. */
export const votePostDto = z.object({
  voteType: z.enum(postVoteTypes),
});
export type VotePostInput = z.infer<typeof votePostDto>;

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });
